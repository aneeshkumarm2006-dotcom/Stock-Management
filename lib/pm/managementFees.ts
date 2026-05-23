// Management-fee collection helper (PDR §3.27, BR-AC-16). Implements
// `Collect management fees`: walks every active Property with a
// `managementFeeAgreement.active === true` whose effective window
// overlaps [periodStart, periodEnd] and posts a cross-property JE per
// Property × period:
//
//   debit  Management Fee Expense  (per-property scope)
//   credit Management Fee Income   (Company scope)
//
// Idempotency: the helper bumps Property.managementFeeAgreement.lastCollectedDate.
// Subsequent calls with the same period skip Properties whose
// lastCollectedDate is on or after periodEnd.
//
// Fee amount:
//   - feeFlatCents (when set)                — fixed amount per period.
//   - feePercent  (when set)                 — % of Income (rent + other)
//                                              posted to this Property in
//                                              the window. Computed from
//                                              the GL.
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { Property } from '@/lib/db/models/pm/Property';
import { JournalEntry } from '@/lib/db/models/pm/JournalEntry';
import { ChartOfAccount } from '@/lib/db/models/pm/ChartOfAccount';
import { assertWriteAllowed, LockedPeriodError } from '@/lib/pm/lockedPeriod';
import type { PmContext } from '@/lib/auth/getCurrentUser';

export interface CollectManagementFeesInput {
  orgId: string;
  ctx: PmContext;
  periodStart: Date;
  periodEnd: Date;
  /** Optional subset of properties to collect against (e.g. user
   *  selected a single property in the modal). */
  propertyIds?: string[];
}

export interface CollectManagementFeesResult {
  posted: Array<{
    propertyId: string;
    propertyName: string;
    feeCents: number;
    journalEntryId: string;
  }>;
  skipped: Array<{
    propertyId: string;
    reason: string;
  }>;
}

async function computePeriodIncomeCents(opts: {
  orgId: Types.ObjectId;
  propertyId: Types.ObjectId;
  periodStart: Date;
  periodEnd: Date;
}): Promise<number> {
  const incomeAccounts = await ChartOfAccount.find(
    { organizationId: opts.orgId, type: 'Income' },
    { _id: 1 },
  ).lean<{ _id: Types.ObjectId }[]>();
  const incomeIds = incomeAccounts.map((a) => a._id);
  if (incomeIds.length === 0) return 0;

  const jes = await JournalEntry.find({
    organizationId: opts.orgId,
    status: 'Posted',
    date: { $gte: opts.periodStart, $lte: opts.periodEnd },
    'lines.scopeId': opts.propertyId,
  })
    .select('lines')
    .lean<{
      lines: Array<{
        accountId: Types.ObjectId;
        scopeType: string;
        scopeId: Types.ObjectId | null;
        debit: number;
        credit: number;
      }>;
    }[]>();

  const incomeIdSet = new Set(incomeIds.map((i) => String(i)));
  let total = 0;
  for (const je of jes) {
    for (const line of je.lines) {
      if (line.scopeType !== 'Property') continue;
      if (String(line.scopeId) !== String(opts.propertyId)) continue;
      if (!incomeIdSet.has(String(line.accountId))) continue;
      // Income accounts: credit increases income.
      total += (line.credit ?? 0) - (line.debit ?? 0);
    }
  }
  return total;
}

export async function collectManagementFees(
  input: CollectManagementFeesInput,
): Promise<CollectManagementFeesResult> {
  await connectToDatabase();
  const orgObjectId = new Types.ObjectId(input.orgId);

  const [feeExpenseCoA, feeIncomeCoA] = await Promise.all([
    ChartOfAccount.findOne({
      organizationId: orgObjectId,
      defaultFor: 'Management Fee Expense',
    }).lean<{ _id: Types.ObjectId } | null>(),
    ChartOfAccount.findOne({
      organizationId: orgObjectId,
      defaultFor: 'Management Fee Income',
    }).lean<{ _id: Types.ObjectId } | null>(),
  ]);
  if (!feeExpenseCoA || !feeIncomeCoA) {
    throw new Error(
      'Management Fee Expense / Income CoAs missing. Run the system seeder before collecting fees.',
    );
  }

  const propertyFilter: Record<string, unknown> = {
    organizationId: orgObjectId,
    active: true,
    'managementFeeAgreement.active': true,
  };
  if (input.propertyIds && input.propertyIds.length > 0) {
    propertyFilter._id = {
      $in: input.propertyIds.map((id) => new Types.ObjectId(id)),
    };
  }
  const properties = await Property.find(propertyFilter).lean<
    Array<{
      _id: Types.ObjectId;
      propertyName: string;
      managementFeeAgreement?: {
        feePercent?: number | null;
        feeFlatCents?: number | null;
        startDate?: Date | null;
        endDate?: Date | null;
        lastCollectedDate?: Date | null;
      } | null;
    }>
  >();

  const posted: CollectManagementFeesResult['posted'] = [];
  const skipped: CollectManagementFeesResult['skipped'] = [];

  for (const prop of properties) {
    const mfa = prop.managementFeeAgreement;
    if (!mfa) continue;

    // Window overlap check.
    if (mfa.startDate && mfa.startDate > input.periodEnd) {
      skipped.push({
        propertyId: String(prop._id),
        reason: 'Agreement not yet active in this period.',
      });
      continue;
    }
    if (mfa.endDate && mfa.endDate < input.periodStart) {
      skipped.push({
        propertyId: String(prop._id),
        reason: 'Agreement ended before this period.',
      });
      continue;
    }
    if (
      mfa.lastCollectedDate &&
      mfa.lastCollectedDate >= input.periodEnd
    ) {
      skipped.push({
        propertyId: String(prop._id),
        reason: 'Already collected through period end.',
      });
      continue;
    }

    let feeCents = 0;
    if (mfa.feeFlatCents && mfa.feeFlatCents > 0) {
      feeCents = mfa.feeFlatCents;
    } else if (mfa.feePercent && mfa.feePercent > 0) {
      const income = await computePeriodIncomeCents({
        orgId: orgObjectId,
        propertyId: prop._id,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
      });
      feeCents = Math.round((income * mfa.feePercent) / 100);
    }
    if (feeCents <= 0) {
      skipped.push({
        propertyId: String(prop._id),
        reason: 'Computed fee is zero (no income or fee rate).',
      });
      continue;
    }

    try {
      await assertWriteAllowed({
        orgId: input.orgId,
        txnDate: input.periodEnd,
        scopePropertyId: String(prop._id),
        ctx: input.ctx,
      });
    } catch (err) {
      if (err instanceof LockedPeriodError) {
        skipped.push({
          propertyId: String(prop._id),
          reason: `Locked period: ${err.policyMessage}`,
        });
        continue;
      }
      throw err;
    }

    const je = await JournalEntry.create({
      organizationId: orgObjectId,
      date: input.periodEnd,
      scopeType: 'Property',
      scopeId: prop._id,
      memo: `Management fee — ${prop.propertyName} ${input.periodStart
        .toISOString()
        .slice(0, 7)}`,
      lines: [
        {
          accountId: feeExpenseCoA._id,
          scopeType: 'Property',
          scopeId: prop._id,
          unitId: null,
          description: 'Management fee',
          debit: feeCents,
          credit: 0,
        },
        {
          accountId: feeIncomeCoA._id,
          scopeType: 'Company',
          scopeId: null,
          unitId: null,
          description: `Mgmt fee from ${prop.propertyName}`,
          debit: 0,
          credit: feeCents,
        },
      ],
      status: 'Posted',
      createdByUserId: new Types.ObjectId(input.ctx.userId),
    });

    await Property.updateOne(
      { _id: prop._id, organizationId: orgObjectId },
      {
        $set: {
          'managementFeeAgreement.lastCollectedDate': input.periodEnd,
        },
      },
    );

    posted.push({
      propertyId: String(prop._id),
      propertyName: prop.propertyName,
      feeCents,
      journalEntryId: String(je._id),
    });
  }

  return { posted, skipped };
}
