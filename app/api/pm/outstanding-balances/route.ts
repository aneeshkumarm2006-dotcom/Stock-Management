// Outstanding Balances — Dashboard widget aggregator (PROPERTY_TODO.md Phase 10).
// Sums posted JournalEntry lines against AR (Accounts Receivable) accounts,
// grouped by (propertyId, unitId), then joins to Lease + Property + Unit for
// the row label. Returns the top 5 by balance plus the count of all leases
// with a positive balance.
//
// Why aggregate here rather than client-side:
//  - The journal is large; we never want the dashboard to pull every JE.
//  - AR account discovery is org-wide and shouldn't be re-computed per
//    user session.
//
// Sign convention: AR is a debit-normal asset account. A positive balance
// means money owed to the org. We expose `balanceCents` as `debit - credit`
// — receipts (credits) reduce the balance.
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { ChartOfAccount } from '@/lib/db/models/pm/ChartOfAccount';
import { JournalEntry } from '@/lib/db/models/pm/JournalEntry';
import { Lease } from '@/lib/db/models/pm/Lease';
import { Property } from '@/lib/db/models/pm/Property';
import { Unit } from '@/lib/db/models/pm/Unit';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';

export const runtime = 'nodejs';

interface AggRow {
  _id: { propertyId: Types.ObjectId | null; unitId: Types.ObjectId | null };
  balanceCents: number;
}

export async function GET() {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();

  await connectToDatabase();
  const orgId = new Types.ObjectId(ctx.orgId);

  // 1. Find AR accounts for this org (typically one, but support overrides).
  const arAccounts = await ChartOfAccount.find({
    organizationId: orgId,
    defaultFor: 'Accounts Receivable',
  })
    .select({ _id: 1 })
    .lean();

  if (arAccounts.length === 0) {
    return NextResponse.json({ totalCents: 0, count: 0, top: [] });
  }
  const arAccountIds = arAccounts.map((a) => a._id);

  // 2. Aggregate posted JE lines against the AR account(s), grouped by
  //    (propertyId / scopeId, unitId). Skip Voided entries entirely.
  const agg = (await JournalEntry.aggregate([
    {
      $match: {
        organizationId: orgId,
        status: 'Posted',
        'lines.accountId': { $in: arAccountIds },
      },
    },
    { $unwind: '$lines' },
    { $match: { 'lines.accountId': { $in: arAccountIds } } },
    {
      $group: {
        _id: {
          propertyId: '$lines.scopeId',
          unitId: '$lines.unitId',
        },
        balanceCents: {
          $sum: { $subtract: ['$lines.debit', '$lines.credit'] },
        },
      },
    },
    { $match: { balanceCents: { $gt: 0 } } },
    { $sort: { balanceCents: -1 } },
  ])) as AggRow[];

  if (agg.length === 0) {
    return NextResponse.json({ totalCents: 0, count: 0, top: [] });
  }

  const totalCents = agg.reduce((acc, r) => acc + r.balanceCents, 0);
  const top5 = agg.slice(0, 5);

  // 3. Fetch labels for the top 5 rows. Properties + Units fetched in
  //    parallel; missing references (e.g., property archived) fall back to
  //    a placeholder string.
  const propIds = top5
    .map((r) => r._id.propertyId)
    .filter((p): p is Types.ObjectId => p instanceof Types.ObjectId);
  const unitIds = top5
    .map((r) => r._id.unitId)
    .filter((u): u is Types.ObjectId => u instanceof Types.ObjectId);

  const [props, units, leases] = await Promise.all([
    propIds.length === 0
      ? Promise.resolve([])
      : Property.find({ _id: { $in: propIds }, organizationId: orgId })
          .select({ _id: 1, propertyName: 1, propertySubType: 1 })
          .lean(),
    unitIds.length === 0
      ? Promise.resolve([])
      : Unit.find({ _id: { $in: unitIds }, organizationId: orgId })
          .select({ _id: 1, unitId: 1, propertyId: 1 })
          .lean(),
    // For "View ledger" deep-linking we surface the active lease id when one
    // exists for the (property, unit) pair. Future leases come along for the
    // ride so a freshly-signed lease still resolves.
    unitIds.length === 0
      ? Promise.resolve([])
      : Lease.find({
          organizationId: orgId,
          unitId: { $in: unitIds },
          status: { $in: ['Active', 'Future'] },
        })
          .select({ _id: 1, unitId: 1, propertyId: 1 })
          .sort({ status: 1, startDate: -1 })
          .lean(),
  ]);

  const propById = new Map(props.map((p) => [String(p._id), p]));
  const unitById = new Map(units.map((u) => [String(u._id), u]));
  const leaseByUnit = new Map<string, { _id: unknown }>();
  for (const l of leases) {
    const key = String(l.unitId);
    if (!leaseByUnit.has(key)) leaseByUnit.set(key, l);
  }

  const top = top5.map((row) => {
    const pKey = row._id.propertyId ? String(row._id.propertyId) : null;
    const uKey = row._id.unitId ? String(row._id.unitId) : null;
    const prop = pKey ? propById.get(pKey) : null;
    const unit = uKey ? unitById.get(uKey) : null;
    const lease = uKey ? leaseByUnit.get(uKey) : null;
    const propertyName = prop?.propertyName ?? 'Unknown property';
    const subType = prop?.propertySubType ? ` (${prop.propertySubType})` : '';
    const unitLabel = unit?.unitId ? ` - ${unit.unitId}` : '';
    return {
      propertyId: pKey,
      unitId: uKey,
      leaseId: lease ? String(lease._id) : null,
      label: `${propertyName}${subType}${unitLabel}`,
      balanceCents: row.balanceCents,
    };
  });

  return NextResponse.json({
    totalCents,
    count: agg.length,
    top,
  });
}
