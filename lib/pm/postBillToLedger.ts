// postBillToLedger — invoked by `POST /api/pm/bills` when the bill is
// recorded as anything other than Draft (BR-MV-8). Builds a balanced
// JournalEntry: each `bill.lines[*]` becomes a debit line; the
// org-default `Accounts Payable` CoA is the offsetting credit (BR-AC-4).
//
// Locked-period gating (BR-AC-3) runs BEFORE the JE is written so the
// route can return 423 with a clean message instead of half-creating
// records.
//
// Mirrors the Deposit → JE wiring at `app/api/pm/deposits/route.ts`
// (lines 140–180).
import { Types } from "mongoose";
import { ChartOfAccount } from "@/lib/db/models/pm/ChartOfAccount";
import {
  JournalEntry,
  type IJournalLine,
} from "@/lib/db/models/pm/JournalEntry";
import type { JournalEntryScopeType } from "@/types/pm";
import { assertWriteAllowed, LockedPeriodError } from "@/lib/pm/lockedPeriod";
import {
  isPropertyScope,
  normalizeScope,
  scopeFromPropertyId,
  toJournalLineScope,
  type PmScope,
} from "@/lib/pm/scope";
import type { PmContext } from "@/lib/auth/getCurrentUser";

export interface BillLedgerLine {
  /** FK ChartOfAccount. */
  accountId: Types.ObjectId;
  description?: string;
  /** Cents (already converted by the caller). */
  amount: number;
  /**
   * Optional per-line scope override. Absent ⇒ the line inherits the bill's
   * scope, which is what every bill did before allocation existed.
   *
   * This is what lets ONE payable carry per-property expense: a blanket
   * insurance premium is a single obligation to a single vendor (so the bill
   * and its AP credit stay at the company) while each debit lands on the
   * building that share belongs to.
   */
  scopeType?: "Property" | "Company" | null;
  scopeId?: Types.ObjectId | string | null;
}

export interface PostBillToLedgerInput {
  orgId: string;
  ctx: PmContext;
  bill: {
    _id: Types.ObjectId;
    invoiceDate: Date;
    memo?: string;
    vendorId?: Types.ObjectId | null;
    /**
     * @deprecated Pass `scope` instead. Kept so existing callers compile
     * unchanged; `scopeFromPropertyId` reproduces the old inference exactly.
     *
     * This field is why a Company-scoped bill could never carry a real
     * CompanyAccount id: the scope TYPE was derived from the truthiness of a
     * property id, so "Company" was structurally the same thing as "no id".
     */
    scopePropertyId?: Types.ObjectId | string | null;
    /** The bill's full scope. Wins over `scopePropertyId` when supplied. */
    scope?: PmScope;
    lines: BillLedgerLine[];
    attachmentFileId?: Types.ObjectId | null;
  };
}

export interface PostBillToLedgerResult {
  journalEntryId: Types.ObjectId;
  totalCents: number;
}

/** The shape of an accrual JournalEntry derived from a bill — everything
 *  needed to either create a fresh JE or update an existing one in place. */
export interface BillJeFields {
  date: Date;
  scopeType: JournalEntryScopeType;
  scopeId: Types.ObjectId | null;
  memo: string;
  attachmentFileId: Types.ObjectId | null;
  lines: IJournalLine[];
  totalCents: number;
}

/**
 * Pure builder for a bill's accrual JE fields: looks up the org-default
 * Accounts Payable CoA and turns `bill.lines[*]` into debits offset by a
 * single AP credit. Does NO DB writes and NO locked-period check — the caller
 * owns those, so this can be reused both when creating a new JE
 * (`postBillToLedger`) and when re-posting an edited bill in place
 * (`repostBillJournalEntry`). Throws if AP is unconfigured or the total is zero.
 */
export async function buildBillJeFields(input: {
  orgId: string;
  bill: PostBillToLedgerInput["bill"];
}): Promise<BillJeFields> {
  const orgObjectId = new Types.ObjectId(input.orgId);

  const ap = await ChartOfAccount.findOne({
    organizationId: orgObjectId,
    defaultFor: "Accounts Payable",
  }).lean<{ _id: Types.ObjectId } | null>();
  if (!ap) {
    throw new Error(
      "No Accounts Payable chart-of-accounts row is set for this org. Configure one in Settings → Chart of Accounts before recording bills.",
    );
  }

  let total = 0;
  for (const line of input.bill.lines) {
    if (!Number.isFinite(line.amount)) {
      throw new Error("Bill lines must have numeric amounts.");
    }
    total += line.amount;
  }
  if (total === 0) {
    throw new Error("Bill total must be non-zero.");
  }

  const billScope = input.bill.scope ?? scopeFromPropertyId(input.bill.scopePropertyId);
  const { scopeType: billScopeType, scopeId: billScopeIdRaw } =
    toJournalLineScope(billScope);
  const scopeType = billScopeType as JournalEntryScopeType;
  const scopeId = billScopeIdRaw ? new Types.ObjectId(billScopeIdRaw) : null;

  // A line's own scope wins over the bill's. Only allocation sets one today,
  // so for every existing bill this is the bill scope on every line — exactly
  // what it was before.
  const debits = input.bill.lines.map((l) => {
    const lineScope =
      l.scopeType || l.scopeId
        ? toJournalLineScope(
            normalizeScope({ scopeType: l.scopeType, scopeId: l.scopeId }),
          )
        : null;
    return {
      accountId: l.accountId,
      scopeType: (lineScope?.scopeType ?? scopeType) as JournalEntryScopeType,
      scopeId: lineScope
        ? lineScope.scopeId
          ? new Types.ObjectId(lineScope.scopeId)
          : null
        : scopeId,
      unitId: null,
      name: undefined,
      description: l.description ?? "",
      debit: l.amount,
      credit: 0,
    };
  });

  // The payable itself is NOT allocated — one invoice, one vendor, one debt,
  // owed by whoever the bill is scoped to.
  const credit = {
    accountId: ap._id,
    scopeType,
    scopeId,
    unitId: null,
    name: undefined,
    description: "Bill payable",
    debit: 0,
    credit: total,
  };

  return {
    date: input.bill.invoiceDate,
    scopeType,
    scopeId,
    memo: input.bill.memo ? `Bill — ${input.bill.memo}`.slice(0, 256) : "Bill",
    attachmentFileId: input.bill.attachmentFileId ?? null,
    lines: [...debits, credit] as unknown as IJournalLine[],
    totalCents: total,
  };
}

export async function postBillToLedger(
  input: PostBillToLedgerInput,
): Promise<PostBillToLedgerResult> {
  const orgObjectId = new Types.ObjectId(input.orgId);
  const billScope =
    input.bill.scope ?? scopeFromPropertyId(input.bill.scopePropertyId);
  const scopePropertyId = isPropertyScope(billScope)
    ? String(billScope.id)
    : null;

  await assertWriteAllowed({
    orgId: input.orgId,
    txnDate: input.bill.invoiceDate,
    scopePropertyId,
    ctx: input.ctx,
  });

  const fields = await buildBillJeFields({
    orgId: input.orgId,
    bill: input.bill,
  });

  const je = await JournalEntry.create({
    organizationId: orgObjectId,
    date: fields.date,
    scopeType: fields.scopeType,
    scopeId: fields.scopeId,
    memo: fields.memo,
    attachmentFileId: fields.attachmentFileId,
    lines: fields.lines,
    status: "Posted",
    createdByUserId: new Types.ObjectId(input.ctx.userId),
  });

  return { journalEntryId: je._id, totalCents: fields.totalCents };
}

export { LockedPeriodError };
