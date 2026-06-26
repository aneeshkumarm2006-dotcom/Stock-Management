// billReflection — explains why a Bill is (or isn't) reflected in the
// Financials → Profit & Loss matrix. The matrix
// (`app/api/pm/financials/matrix/route.ts`) reads **JournalEntry** rows, not
// Bills, and counts a line only when the JE is `Posted`, the line posts to an
// active Income/Operating-Expense account, and the JE date sits inside the
// selected window. (Property scope no longer excludes anything: the matrix now
// renders archived-property activity under a dedicated "(archived)" column, so
// a scoped expense always lands in some column.) A Bill that shows in the Bills
// list but is missing from Financials therefore falls into one of the reasons
// below.
//
// One classifier, three consumers: the reconciliation API
// (`/api/pm/financials/reconciliation`), the Financials banner, and the
// Bills-list "Not in Financials" indicator — so the rules stay in one place and
// can't drift from what the matrix actually aggregates.
//
// Callers must have already run `connectToDatabase()` (mirrors the
// caller-connects convention used by `postBillToLedger`).
import { Types } from 'mongoose';
import { Bill } from '@/lib/db/models/pm/Bill';
import { JournalEntry } from '@/lib/db/models/pm/JournalEntry';
import { ChartOfAccount } from '@/lib/db/models/pm/ChartOfAccount';

export type BillReflectionReason =
  /** Draft, or no `journalEntryId` — never posted to the ledger. */
  | 'UNPOSTED'
  /** `journalEntryId` set but the JE is absent or not `Posted` (e.g. voided). */
  | 'JE_MISSING'
  /** Posted, but no line hits an active Income/Operating-Expense account. */
  | 'NON_PL_ACCOUNT'
  /** Reflected structurally, but the JE date falls outside the given window. */
  | 'OUTSIDE_DATE_RANGE';

export interface BillReflection {
  billId: string;
  refNo: string;
  vendorId: string | null;
  /** Integer cents. */
  amount: number;
  status: string;
  /** ISO string, or '' when unset. */
  invoiceDate: string;
  scope: { type: string; id: string | null };
  reflected: boolean;
  reason: BillReflectionReason | null;
}

export interface ReflectionReasonBucket {
  count: number;
  /** Integer cents. */
  cents: number;
}

export interface BillReflectionSummary {
  totalUnreflected: number;
  /** Integer cents. */
  totalUnreflectedCents: number;
  byReason: Record<BillReflectionReason, ReflectionReasonBucket>;
}

export interface ClassifyBillsResult {
  bills: BillReflection[];
  unreflected: BillReflection[];
  summary: BillReflectionSummary;
}

const REASONS: BillReflectionReason[] = [
  'UNPOSTED',
  'JE_MISSING',
  'NON_PL_ACCOUNT',
  'OUTSIDE_DATE_RANGE',
];

interface BillLean {
  _id: Types.ObjectId;
  vendorId?: Types.ObjectId | null;
  refNo?: string;
  amount: number;
  status: string;
  invoiceDate: Date;
  scope?: { type: string; id?: Types.ObjectId | null };
  journalEntryId?: Types.ObjectId | null;
}

interface JeLean {
  _id: Types.ObjectId;
  status: string;
  date: Date;
  lines: { accountId: Types.ObjectId }[];
}

export interface ClassifyBillsOptions {
  orgId: string;
  /** Date-only string (YYYY-MM-DD) or null. Mirrors the matrix `from`/`to`. */
  from?: string | null;
  to?: string | null;
}

/**
 * Classify every non-Voided bill for an org by whether it is reflected in the
 * P&L matrix, and if not, why. When `from`/`to` are omitted, only structural
 * exclusions are reported (no `OUTSIDE_DATE_RANGE`), which is what the Bills
 * list wants; pass the active window to match what the Financials page shows.
 */
export async function classifyBills(
  opts: ClassifyBillsOptions,
): Promise<ClassifyBillsResult> {
  const orgObjectId = new Types.ObjectId(opts.orgId);
  const fromDate = opts.from ? new Date(opts.from) : null;
  const toDate = opts.to ? new Date(opts.to) : null;

  // Same account source the matrix route uses (active Income/Operating-Expense
  // accounts), so "reflected" here means exactly "would show in the matrix".
  const [bills, plAccounts] = await Promise.all([
    Bill.find({ organizationId: orgObjectId, status: { $ne: 'Voided' } })
      .sort({ invoiceDate: -1 })
      .lean<BillLean[]>(),
    ChartOfAccount.find({
      organizationId: orgObjectId,
      active: true,
      type: { $in: ['Income', 'Operating Expense'] },
    })
      .select({ _id: 1 })
      .lean<{ _id: Types.ObjectId }[]>(),
  ]);

  const plSet = new Set(plAccounts.map((a) => String(a._id)));

  const jeIds = bills
    .map((b) => b.journalEntryId)
    .filter((x): x is Types.ObjectId => Boolean(x));
  const jes = jeIds.length
    ? await JournalEntry.find({
        _id: { $in: jeIds },
        organizationId: orgObjectId,
      })
        .select({ _id: 1, status: 1, date: 1, 'lines.accountId': 1 })
        .lean<JeLean[]>()
    : [];
  const jeById = new Map(jes.map((j) => [String(j._id), j]));

  const dateOk = (d: Date | null | undefined): boolean => {
    if (!d) return false;
    const t = new Date(d).getTime();
    if (fromDate && t < fromDate.getTime()) return false;
    if (toDate && t > toDate.getTime()) return false;
    return true;
  };

  const reflections: BillReflection[] = bills.map((b) => {
    const base = {
      billId: String(b._id),
      refNo: b.refNo ?? '',
      vendorId: b.vendorId ? String(b.vendorId) : null,
      amount: b.amount ?? 0,
      status: b.status,
      invoiceDate: b.invoiceDate ? new Date(b.invoiceDate).toISOString() : '',
      scope: {
        type: b.scope?.type ?? 'Company',
        id: b.scope?.id ? String(b.scope.id) : null,
      },
    };

    // A. Draft / no JE link — never reaches the ledger.
    if (b.status === 'Draft' || !b.journalEntryId) {
      return { ...base, reflected: false, reason: 'UNPOSTED' as const };
    }

    // B. JE link present but the JE is gone or not Posted (e.g. voided).
    const je = jeById.get(String(b.journalEntryId));
    if (!je || je.status !== 'Posted') {
      return { ...base, reflected: false, reason: 'JE_MISSING' as const };
    }

    // C. Posted but no line hits a P&L account (e.g. a capital/asset bill).
    const hasPlLine = (je.lines ?? []).some((l) =>
      plSet.has(String(l.accountId)),
    );
    if (!hasPlLine) {
      return { ...base, reflected: false, reason: 'NON_PL_ACCOUNT' as const };
    }

    // D. Structurally reflected, but the JE date is outside the asked window.
    if (!dateOk(je.date)) {
      return {
        ...base,
        reflected: false,
        reason: 'OUTSIDE_DATE_RANGE' as const,
      };
    }

    return { ...base, reflected: true, reason: null };
  });

  const unreflected = reflections.filter((r) => !r.reflected);
  const byReason = Object.fromEntries(
    REASONS.map((r) => [r, { count: 0, cents: 0 }]),
  ) as Record<BillReflectionReason, ReflectionReasonBucket>;
  for (const r of unreflected) {
    if (!r.reason) continue;
    byReason[r.reason].count += 1;
    byReason[r.reason].cents += r.amount;
  }

  return {
    bills: reflections,
    unreflected,
    summary: {
      totalUnreflected: unreflected.length,
      totalUnreflectedCents: unreflected.reduce((s, r) => s + r.amount, 0),
      byReason,
    },
  };
}
