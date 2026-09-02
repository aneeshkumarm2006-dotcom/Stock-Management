// Financials P&L matrix endpoint (BR-AC-2, BR-AC-15).
//
// Returns rows = Income + Operating Expense CoA rows, columns = active
// Properties + a "Company" pseudo-property, cells = signed net (income shown
// positive, expense shown positive) for the period.
//
// Which JEs count is decided by `ledgerVisibleMatch()` — Posted, excluding the
// reversal half of a voided pair. Filtering on `status: 'Posted'` alone used to
// keep a void's reversing entry while dropping its Voided original, so voiding
// one bill silently subtracted from every other bill sharing that
// account/property/month (C$724.73 rendered as C$13.30). See
// lib/pm/ledgerVisibility.ts.
//
// Cash vs Accrual: the Phase 2 MVP returns the same matrix regardless — the
// toggle is mainly a placeholder so the UI surface exists. Phase 9 will
// refine cash-basis to "only count entries that hit a cash CoA"; until then
// both modes use the underlying ledger as-is. The org.accountingMode is still
// surfaced so the UI can display the active mode.
//
// CURRENCY. Every COLUMN carries its own resolved currency; CELLS deliberately
// do not. A cell is keyed `accountId|propertyId`, so its column already
// determines what it is denominated in — putting the currency on both would
// create two sources of truth that can drift. Every cell provably has a column
// (the archived-orphan logic below guarantees it), so nothing is left
// unlabelled. The page uses this to render each column natively and to bucket
// row/grand totals into a MoneyByCurrency instead of adding CAD to USD.
//
// COMPANY COLUMNS. `scopeReportKey` is called with splitByCompany ON, so every
// Company-scoped line naming a real CompanyAccount gets its own `company:<id>`
// column resolved via resolveCompanyCurrency (a legal entity books in its own
// currency, which need not be the org default). The bare `company` sentinel
// survives as the legacy bucket for rows written before named companies
// existed — those carry `scopeId: null` and mean "the organization's own
// books", and are never rewritten (see lib/db/models/pm/JournalEntry.ts).
//
// The company column list is derived from the AGGREGATION ROWS, not from the
// CompanyAccount table, for the same reason the archived-property columns are:
// a cell whose column was filtered out is dropped from every total.
import { NextResponse } from "next/server";
import { Types } from "mongoose";
import { connectToDatabase } from "@/lib/db/mongoose";
import { ChartOfAccount } from "@/lib/db/models/pm/ChartOfAccount";
import { JournalEntry } from "@/lib/db/models/pm/JournalEntry";
import { Property } from "@/lib/db/models/pm/Property";
import { Organization } from "@/lib/db/models/pm/Organization";
import { BankAccount } from "@/lib/db/models/pm/BankAccount";
import { getPmContext, unauthorizedResponse } from "@/lib/auth/getCurrentUser";
import {
  resolveCompanyCurrency,
  resolvePropertyCurrency,
} from "@/lib/pm/currency";
import {
  COMPANY_SENTINEL,
  companyIdFromColumnId,
  scopeReportKey,
} from "@/lib/pm/scope";
import { CompanyAccount } from "@/lib/db/models/pm/CompanyAccount";
import { ledgerVisibleMatch } from "@/lib/pm/ledgerVisibility";
import { dateWindowClause, parseDateWindow } from "@/lib/pm/dateWindow";
import type { PmCurrency } from "@/types/pm";

export const runtime = "nodejs";

interface CellKey {
  accountId: string;
  /**
   * A column id, not necessarily a property: a Property `_id`, the bare
   * `company` sentinel, or `company:<CompanyAccount _id>`. The field keeps its
   * historical name because it is the wire contract the page reads.
   */
  propertyId: string;
}

export async function GET(request: Request) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();

  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  await connectToDatabase();
  const orgObjectId = new Types.ObjectId(ctx.orgId);

  const [org, accounts, properties] = await Promise.all([
    Organization.findById(orgObjectId).lean(),
    ChartOfAccount.find({
      organizationId: orgObjectId,
      active: true,
      type: { $in: ["Income", "Operating Expense"] },
    })
      .sort({ type: 1, name: 1 })
      .lean(),
    // Projected and typed explicitly: the previous untyped `.lean()` returned
    // `currency` all along, which is how it went unnoticed that the columns
    // were never labelled with it.
    Property.find({ organizationId: orgObjectId, active: true })
      .select({ _id: 1, propertyName: 1, currency: 1 })
      .sort({ propertyName: 1 })
      .lean<
        Array<{
          _id: Types.ObjectId;
          propertyName: string;
          currency?: PmCurrency | null;
        }>
      >(),
  ]);

  const orgDefaultCurrency: PmCurrency =
    (org as { defaultCurrency?: PmCurrency } | null)?.defaultCurrency ?? "USD";

  const accountIds = accounts.map((a) => a._id);

  // Half-open UTC interval — `to` is inclusive of its whole calendar day. The
  // old `$lte: new Date(to)` was midnight on that day, silently dropping any
  // entry dated on the window's last day that carries a time. See
  // lib/pm/dateWindow.ts; lib/pm/billReflection.ts uses the same bounds so the
  // "not reflected here" banner still agrees with this matrix exactly.
  const dateClause = dateWindowClause(parseDateWindow(from, to));

  const matchStage: Record<string, unknown> = {
    organizationId: orgObjectId,
    ...ledgerVisibleMatch(),
  };
  if (dateClause) matchStage.date = dateClause;

  const rows: {
    _id: {
      accountId: Types.ObjectId;
      scopeId: Types.ObjectId | null;
      scopeType: string;
    };
    net: number;
  }[] =
    accountIds.length === 0
      ? []
      : await JournalEntry.aggregate([
          { $match: matchStage },
          { $unwind: "$lines" },
          { $match: { "lines.accountId": { $in: accountIds } } },
          {
            $group: {
              _id: {
                accountId: "$lines.accountId",
                scopeId: "$lines.scopeId",
                scopeType: "$lines.scopeType",
              },
              net: { $sum: { $subtract: ["$lines.credit", "$lines.debit"] } },
            },
          },
        ]);

  // For Income (credit-natural), net = credit − debit reads positive when
  // money flowed in. For Operating Expense (debit-natural), reverse the sign
  // so expenses display positive too (matching Buildium P&L convention).
  //
  // Column keys come from `scopeReportKey` with splitByCompany ON, so a line
  // naming a real CompanyAccount lands on `company:<id>` and gets its own
  // column, while every legacy `scopeId: null` row still collapses onto the
  // bare `company` sentinel. Deriving the key here rather than re-inlining the
  // Property/Company test is what keeps this route and the recurring list from
  // disagreeing about where a rule posts.
  const cells = new Map<string, number>();
  for (const row of rows) {
    const accountId = String(row._id.accountId);
    const accountType = accounts.find((a) => String(a._id) === accountId)?.type;
    const columnId = scopeReportKey(
      { scopeType: row._id.scopeType, scopeId: row._id.scopeId },
      COMPANY_SENTINEL.matrix,
      { splitByCompany: true },
    );
    const signedNet = accountType === "Operating Expense" ? -row.net : row.net;
    const key: CellKey = { accountId, propertyId: columnId };
    const k = `${key.accountId}|${key.propertyId}`;
    cells.set(k, (cells.get(k) ?? 0) + signedNet);
  }

  // Surface amounts scoped to ARCHIVED (inactive/deleted) properties so they
  // never silently vanish from the P&L. The aggregation keys such cells by the
  // real property _id, but the column list above only contains *active*
  // properties — a posted expense on a later-archived property would then have
  // no column to render into and would be dropped from every column/grand total
  // (BR-AC-15 reconciliation). Give each orphan scope its own "(archived)"
  // column so the cells render and the totals add up.
  const activePropIds = new Set(properties.map((p) => String(p._id)));
  const orphanPropIds = new Set<string>();
  for (const row of rows) {
    if (row._id.scopeType === "Property" && row._id.scopeId) {
      const pid = String(row._id.scopeId);
      if (!activePropIds.has(pid)) orphanPropIds.add(pid);
    }
  }
  const archivedProps = orphanPropIds.size
    ? await Property.find({
        organizationId: orgObjectId,
        _id: {
          $in: Array.from(orphanPropIds).map((id) => new Types.ObjectId(id)),
        },
      })
        .select({ _id: 1, propertyName: 1, currency: 1 })
        .lean<
          Array<{
            _id: Types.ObjectId;
            propertyName: string;
            currency?: PmCurrency | null;
          }>
        >()
    : [];
  // One column per CompanyAccount that actually has activity in the window.
  //
  // Derived from the AGGREGATION ROWS, never from `CompanyAccount.find({active:
  // true})` — same reasoning as the archived-property block above. A company
  // that was archived (or deleted) after being posted to still owns real money;
  // sourcing the column list from the live table would leave those cells with
  // no column, and a cell without a column is dropped from every column and
  // grand total. So every `company:<id>` seen in the data gets a column, and
  // one whose CompanyAccount no longer exists is labelled rather than lost.
  const companyIdsWithActivity = new Set<string>();
  for (const row of rows) {
    const id = companyIdFromColumnId(
      scopeReportKey(
        { scopeType: row._id.scopeType, scopeId: row._id.scopeId },
        COMPANY_SENTINEL.matrix,
        { splitByCompany: true },
      ),
      COMPANY_SENTINEL.matrix,
    );
    if (id) companyIdsWithActivity.add(id);
  }
  const companyDocs = companyIdsWithActivity.size
    ? await CompanyAccount.find({
        organizationId: orgObjectId,
        _id: {
          $in: Array.from(companyIdsWithActivity).map(
            (id) => new Types.ObjectId(id),
          ),
        },
      })
        .select({ _id: 1, name: 1, currency: 1 })
        .sort({ name: 1 })
        .lean<
          Array<{
            _id: Types.ObjectId;
            name?: string;
            currency?: PmCurrency | null;
          }>
        >()
    : [];
  const companyById = new Map(companyDocs.map((c) => [String(c._id), c]));
  const companyColumns = Array.from(companyIdsWithActivity)
    .map((id) => {
      const doc = companyById.get(id);
      return {
        id: `${COMPANY_SENTINEL.matrix}:${id}`,
        name: doc?.name ?? "Unknown company",
        // A company books in its OWN currency (CompanyAccount.currency, which
        // falls back to the org default) — not unconditionally the org default
        // the way the legacy bucket does.
        currency: resolveCompanyCurrency(doc?.currency, orgDefaultCurrency),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const archivedById = new Map(archivedProps.map((p) => [String(p._id), p]));
  const archivedColumns = Array.from(orphanPropIds).map((id) => ({
    id,
    name: `${archivedById.get(id)?.propertyName || "Archived property"} (archived)`,
    // An archived property still booked in a real currency; falling back to the
    // org default here would silently relabel its history.
    currency: resolvePropertyCurrency(
      archivedById.get(id)?.currency,
      orgDefaultCurrency,
    ),
  }));

  // Phase 9 (BR-AC-20) — surface HOA per-association groupings. Pull
  // associationName per active BankAccount; the page can use this to
  // render an "Associations" sub-total row. Only emitted when at least
  // one tag is set, so non-HOA orgs see no change.
  const banks = await BankAccount.find(
    { organizationId: orgObjectId, active: true },
    { _id: 1, associationName: 1 },
  ).lean<Array<{ _id: Types.ObjectId; associationName?: string | null }>>();
  const tagged = banks.filter((b) => b.associationName);
  const associationNames = Array.from(
    new Set(tagged.map((b) => b.associationName as string)),
  ).sort();

  // §6 — surface the org-level estimated income-tax rate so the page can render
  // a company-column-only derived tax footer (no GL write; matches the
  // company-financials report). Defaults 0 ⇒ the footer reads $0.
  const estimatedIncomeTaxRatePct = Math.min(
    100,
    Math.max(
      0,
      (org as { estimatedIncomeTaxRatePct?: number } | null)
        ?.estimatedIncomeTaxRatePct ?? 0,
    ),
  );

  return NextResponse.json({
    accountingMode: org?.accountingMode ?? "accrual",
    estimatedIncomeTaxRatePct,
    accounts: accounts.map((a) => ({
      id: String(a._id),
      name: a.name,
      type: a.type,
    })),
    orgDefaultCurrency,
    columns: [
      {
        // The legacy bucket: Company-scoped rows written before named
        // companies existed, which carry `scopeId: null` and mean "the
        // organization's own books". Kept on the bare sentinel so the wire
        // contract is unchanged. Once real company columns sit beside it the
        // bare label is ambiguous, so say what it actually holds — everything
        // in here is money that has not been attributed to a legal entity yet.
        id: COMPANY_SENTINEL.matrix,
        name: companyColumns.length > 0 ? "Company (unassigned)" : "Company",
        currency: orgDefaultCurrency,
      },
      ...companyColumns,
      ...properties.map((p) => ({
        id: String(p._id),
        name: p.propertyName,
        currency: resolvePropertyCurrency(p.currency, orgDefaultCurrency),
      })),
      ...archivedColumns,
    ],
    cells: Array.from(cells.entries()).map(([k, v]) => {
      const [accountId, propertyId] = k.split("|");
      return { accountId, propertyId, amount: v };
    }),
    associations: associationNames,
  });
}
