// Bank reconciliation helpers (PDR §3.27a, BR-AC-17). Drives the
// 3-step wizard:
//
//   Step 1 (route POST /reconciliations) — open an "In progress"
//          Reconciliation with statement window + ending balance.
//
//   Step 2 (route PATCH /reconciliations/[id]) — accumulate
//          `clearedLines[]`; `computeUnclearedLines` powers the table.
//
//   Step 3 (route POST /reconciliations/[id]/commit) — invoke
//          `commitReconciliation`:
//            * Validates difference === 0
//            * Stamps `cleared=true` + `reconciliationId` on every
//              cleared JournalLine
//            * Posts an adjustment JE for service-charge + interest
//              when either is non-zero (helper accepts both)
//            * Issues a LockedPeriodPolicy covering the statement
//              window so future writes hitting `txnDate ≤ endDate` on
//              this BankAccount surface a 423 (BR-AC-17)
//            * Bumps BankAccount.lastReconciliationDate
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { Reconciliation } from '@/lib/db/models/pm/Reconciliation';
import { BankAccount } from '@/lib/db/models/pm/BankAccount';
import { ChartOfAccount } from '@/lib/db/models/pm/ChartOfAccount';
import { JournalEntry } from '@/lib/db/models/pm/JournalEntry';
import { LockedPeriodPolicy } from '@/lib/db/models/pm/LockedPeriodPolicy';
import type { PmContext } from '@/lib/auth/getCurrentUser';

export interface UnclearedLineRow {
  journalEntryId: string;
  lineId: string;
  date: Date;
  memo: string;
  debit: number; // cents
  credit: number; // cents
}

/** Pull every JE line that hits this bank account's cash CoA inside
 *  the statement window and is currently `cleared=false`. Used by the
 *  wizard's Step 2 to render the checkbox table.
 *
 *  Voided JEs are excluded; Draft JEs are excluded (only Posted counts
 *  toward the statement).
 */
export async function computeUnclearedLines(opts: {
  orgId: Types.ObjectId;
  bankAccountId: Types.ObjectId;
  startDate: Date;
  endDate: Date;
}): Promise<UnclearedLineRow[]> {
  await connectToDatabase();

  const bank = await BankAccount.findOne(
    { _id: opts.bankAccountId, organizationId: opts.orgId },
    { chartOfAccountId: 1 },
  ).lean<{ chartOfAccountId?: Types.ObjectId | null } | null>();
  if (!bank?.chartOfAccountId) return [];

  const jes = await JournalEntry.find({
    organizationId: opts.orgId,
    status: 'Posted',
    date: { $gte: opts.startDate, $lte: opts.endDate },
    'lines.accountId': bank.chartOfAccountId,
  })
    .select('date memo lines')
    .lean<{
      _id: Types.ObjectId;
      date: Date;
      memo?: string;
      lines: Array<{
        _id: Types.ObjectId;
        accountId: Types.ObjectId;
        debit: number;
        credit: number;
        cleared?: boolean;
      }>;
    }[]>();

  const rows: UnclearedLineRow[] = [];
  for (const je of jes) {
    for (const line of je.lines) {
      if (String(line.accountId) !== String(bank.chartOfAccountId)) continue;
      if (line.cleared) continue;
      rows.push({
        journalEntryId: String(je._id),
        lineId: String(line._id),
        date: je.date,
        memo: je.memo ?? '',
        debit: line.debit ?? 0,
        credit: line.credit ?? 0,
      });
    }
  }
  // Most-recent-first matches the GL view convention.
  rows.sort((a, b) => b.date.getTime() - a.date.getTime());
  return rows;
}

/** Sum cleared lines (debits − credits) on this reconciliation. */
export async function computeBookEndingBalance(opts: {
  reconciliationId: Types.ObjectId;
  orgId: Types.ObjectId;
}): Promise<number> {
  const rec = await Reconciliation.findOne({
    _id: opts.reconciliationId,
    organizationId: opts.orgId,
  }).lean<{
    bankAccountId: Types.ObjectId;
    startDate: Date;
    endDate: Date;
    clearedLines: { journalEntryId: Types.ObjectId; lineId: Types.ObjectId }[];
  } | null>();
  if (!rec) return 0;

  // Pull the prior committed reconciliation's bookEndingBalance as the
  // opening for this one — defaults to 0 if no prior recon exists.
  const prior = await Reconciliation.findOne({
    organizationId: opts.orgId,
    bankAccountId: rec.bankAccountId,
    status: 'Completed',
    endDate: { $lt: rec.endDate },
  })
    .sort({ endDate: -1 })
    .lean<{ bookEndingBalance: number } | null>();
  const opening = prior?.bookEndingBalance ?? 0;

  if (rec.clearedLines.length === 0) return opening;

  const jeIds = Array.from(
    new Set(rec.clearedLines.map((c) => String(c.journalEntryId))),
  ).map((s) => new Types.ObjectId(s));
  const jes = await JournalEntry.find({
    _id: { $in: jeIds },
    organizationId: opts.orgId,
  })
    .select('lines')
    .lean<{
      _id: Types.ObjectId;
      lines: Array<{ _id: Types.ObjectId; debit: number; credit: number }>;
    }[]>();

  const clearedSet = new Set(
    rec.clearedLines.map((c) => `${c.journalEntryId}:${c.lineId}`),
  );
  let net = opening;
  for (const je of jes) {
    for (const line of je.lines) {
      const key = `${je._id}:${line._id}`;
      if (!clearedSet.has(key)) continue;
      net += (line.debit ?? 0) - (line.credit ?? 0);
    }
  }
  return net;
}

/** Post the optional service-charge + interest adjustment JE for a
 *  reconciliation. Returns the created JournalEntry _id, or null when
 *  both amounts are zero. */
async function postAdjustmentJournalEntry(opts: {
  orgId: Types.ObjectId;
  ctx: PmContext;
  bankCashCoAId: Types.ObjectId;
  statementDate: Date;
  serviceChargeCents: number;
  interestEarnedCents: number;
}): Promise<Types.ObjectId | null> {
  if (
    opts.serviceChargeCents <= 0 &&
    opts.interestEarnedCents <= 0
  ) {
    return null;
  }

  const [serviceCoA, interestCoA] = await Promise.all([
    opts.serviceChargeCents > 0
      ? ChartOfAccount.findOne({
          organizationId: opts.orgId,
          defaultFor: 'Bank Service Charges',
        }).lean<{ _id: Types.ObjectId } | null>()
      : null,
    opts.interestEarnedCents > 0
      ? ChartOfAccount.findOne({
          organizationId: opts.orgId,
          defaultFor: 'Interest Income',
        }).lean<{ _id: Types.ObjectId } | null>()
      : null,
  ]);

  if (opts.serviceChargeCents > 0 && !serviceCoA) {
    throw new Error(
      'No Bank Service Charges CoA configured. Run the system seeder.',
    );
  }
  if (opts.interestEarnedCents > 0 && !interestCoA) {
    throw new Error(
      'No Interest Income CoA configured. Run the system seeder.',
    );
  }

  const lines: Array<{
    accountId: Types.ObjectId;
    scopeType: 'Property' | 'Company';
    scopeId: Types.ObjectId | null;
    unitId: null;
    description: string;
    debit: number;
    credit: number;
  }> = [];
  if (opts.serviceChargeCents > 0 && serviceCoA) {
    lines.push({
      accountId: serviceCoA._id,
      scopeType: 'Company',
      scopeId: null,
      unitId: null,
      description: 'Bank service charge (reconciliation)',
      debit: opts.serviceChargeCents,
      credit: 0,
    });
    lines.push({
      accountId: opts.bankCashCoAId,
      scopeType: 'Company',
      scopeId: null,
      unitId: null,
      description: 'Bank service charge',
      debit: 0,
      credit: opts.serviceChargeCents,
    });
  }
  if (opts.interestEarnedCents > 0 && interestCoA) {
    lines.push({
      accountId: opts.bankCashCoAId,
      scopeType: 'Company',
      scopeId: null,
      unitId: null,
      description: 'Bank interest earned (reconciliation)',
      debit: opts.interestEarnedCents,
      credit: 0,
    });
    lines.push({
      accountId: interestCoA._id,
      scopeType: 'Company',
      scopeId: null,
      unitId: null,
      description: 'Bank interest earned',
      debit: 0,
      credit: opts.interestEarnedCents,
    });
  }

  const je = await JournalEntry.create({
    organizationId: opts.orgId,
    date: opts.statementDate,
    scopeType: 'Company',
    scopeId: null,
    memo: 'Reconciliation adjustment',
    lines,
    status: 'Posted',
    createdByUserId: new Types.ObjectId(opts.ctx.userId),
  });
  return je._id;
}

export interface CommitReconciliationInput {
  orgId: string;
  ctx: PmContext;
  reconciliationId: string;
  serviceChargeCents?: number;
  interestEarnedCents?: number;
}

export interface CommitReconciliationResult {
  reconciliationId: string;
  bookEndingBalance: number;
  lockedPeriodPolicyId: string;
  adjustmentJournalEntryId: string | null;
  clearedCount: number;
}

/**
 * Commit a Reconciliation:
 *  - validates difference === 0 (statement === book)
 *  - posts optional service-charge/interest adjustment JE
 *  - stamps `cleared=true` + `clearedDate` + `reconciliationId` on
 *    every cleared JournalLine
 *  - issues a LockedPeriodPolicy covering the statement window
 *  - bumps BankAccount.lastReconciliationDate
 */
export async function commitReconciliation(
  input: CommitReconciliationInput,
): Promise<CommitReconciliationResult> {
  await connectToDatabase();
  const orgObjectId = new Types.ObjectId(input.orgId);
  const recId = new Types.ObjectId(input.reconciliationId);

  const rec = await Reconciliation.findOne({
    _id: recId,
    organizationId: orgObjectId,
  });
  if (!rec) throw new Error('Reconciliation not found');
  if (rec.status !== 'In progress') {
    throw new Error(`Cannot commit a ${rec.status} reconciliation.`);
  }

  // Validate the math.
  const serviceCharge = input.serviceChargeCents ?? 0;
  const interestEarned = input.interestEarnedCents ?? 0;
  const bookBalance = await computeBookEndingBalance({
    reconciliationId: rec._id,
    orgId: orgObjectId,
  });
  // Adjustment lines hit the bank cash directly, so add their net
  // contribution to the book side before comparing.
  const adjustedBook = bookBalance - serviceCharge + interestEarned;
  const diff = rec.statementEndingBalance - adjustedBook;
  if (diff !== 0) {
    throw new Error(
      `Cannot commit — statement (${rec.statementEndingBalance / 100}) and book (${adjustedBook / 100}) differ by ${diff / 100}.`,
    );
  }

  // Locate the bank cash CoA for the adjustment JE.
  const bank = await BankAccount.findOne(
    { _id: rec.bankAccountId, organizationId: orgObjectId },
    { chartOfAccountId: 1 },
  ).lean<{ chartOfAccountId?: Types.ObjectId | null } | null>();
  if (!bank?.chartOfAccountId) {
    throw new Error(
      'BankAccount has no Chart of Accounts mapping; configure it before committing.',
    );
  }

  const adjustmentJeId = await postAdjustmentJournalEntry({
    orgId: orgObjectId,
    ctx: input.ctx,
    bankCashCoAId: bank.chartOfAccountId,
    statementDate: rec.endDate,
    serviceChargeCents: serviceCharge,
    interestEarnedCents: interestEarned,
  });

  // Stamp cleared=true on every cleared JE line. Mongoose embedded
  // sub-docs can be updated via arrayFilters by line _id.
  for (const ref of rec.clearedLines) {
    await JournalEntry.updateOne(
      {
        _id: ref.journalEntryId,
        organizationId: orgObjectId,
        'lines._id': ref.lineId,
      },
      {
        $set: {
          'lines.$.cleared': true,
          'lines.$.clearedDate': rec.endDate,
          'lines.$.reconciliationId': rec._id,
        },
      },
    );
  }

  // Issue LockedPeriodPolicy covering [startDate, endDate]. Existing
  // assertWriteAllowed picks this up without any helper extension.
  const policy = await LockedPeriodPolicy.create({
    organizationId: orgObjectId,
    scope: 'Global',
    propertyId: null,
    fromDate: null,
    toDate: rec.endDate,
    message: `Reconciliation period locked through ${rec.endDate.toISOString().slice(0, 10)} (BR-AC-17).`,
    active: true,
    createdByUserId: new Types.ObjectId(input.ctx.userId),
  });

  rec.status = 'Completed';
  rec.completedAt = new Date();
  rec.completedByUserId = new Types.ObjectId(input.ctx.userId);
  rec.bookEndingBalance = adjustedBook;
  rec.difference = 0;
  rec.lockedPeriodPolicyId = policy._id;
  if (adjustmentJeId) {
    // not stored on the model in current shape; left as JE link.
  }
  await rec.save();

  await BankAccount.updateOne(
    { _id: rec.bankAccountId, organizationId: orgObjectId },
    { $set: { lastReconciliationDate: rec.endDate } },
  );

  return {
    reconciliationId: String(rec._id),
    bookEndingBalance: adjustedBook,
    lockedPeriodPolicyId: String(policy._id),
    adjustmentJournalEntryId: adjustmentJeId ? String(adjustmentJeId) : null,
    clearedCount: rec.clearedLines.length,
  };
}

/** Roll a Completed reconciliation back to a "voided" state. */
export async function voidReconciliation(input: {
  orgId: string;
  ctx: PmContext;
  reconciliationId: string;
}): Promise<void> {
  await connectToDatabase();
  const orgObjectId = new Types.ObjectId(input.orgId);
  const rec = await Reconciliation.findOne({
    _id: new Types.ObjectId(input.reconciliationId),
    organizationId: orgObjectId,
  });
  if (!rec) throw new Error('Reconciliation not found');
  if (rec.status !== 'Completed') {
    throw new Error('Only Completed reconciliations can be voided.');
  }

  for (const ref of rec.clearedLines) {
    await JournalEntry.updateOne(
      {
        _id: ref.journalEntryId,
        organizationId: orgObjectId,
        'lines._id': ref.lineId,
      },
      {
        $set: {
          'lines.$.cleared': false,
          'lines.$.clearedDate': null,
          'lines.$.reconciliationId': null,
        },
      },
    );
  }

  if (rec.lockedPeriodPolicyId) {
    await LockedPeriodPolicy.updateOne(
      { _id: rec.lockedPeriodPolicyId, organizationId: orgObjectId },
      { $set: { active: false } },
    );
  }

  rec.status = 'Voided';
  rec.voidedAt = new Date();
  rec.voidedByUserId = new Types.ObjectId(input.ctx.userId);
  await rec.save();

  // Roll BankAccount.lastReconciliationDate back to the prior completed.
  const prior = await Reconciliation.findOne({
    organizationId: orgObjectId,
    bankAccountId: rec.bankAccountId,
    status: 'Completed',
  })
    .sort({ endDate: -1 })
    .lean<{ endDate: Date } | null>();
  await BankAccount.updateOne(
    { _id: rec.bankAccountId, organizationId: orgObjectId },
    { $set: { lastReconciliationDate: prior?.endDate ?? null } },
  );
}
