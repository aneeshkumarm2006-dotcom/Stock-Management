// Outstanding Balances — Dashboard widget aggregator (PROPERTY_TODO.md Phase 10).
// Sums posted JournalEntry lines against AR (Accounts Receivable) accounts,
// grouped by (propertyId, unitId), then joins to Lease + Property + Unit for
// the row label. Returns the top 5 by balance plus the count of all leases
// with a positive balance.
//
// It ALSO returns a per-country breakdown (`groups`): the client operates in
// Canada and the United States and wants each country listed separately with
// its own subtotal. Grouping key is each property's `address.country`
// (normalized). Org currency is single-currency, so grouping by country never
// mixes currencies within a total.
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
import { normalizeCountry, OTHER } from '@/lib/pm/country';

export const runtime = 'nodejs';

interface AggRow {
  _id: { propertyId: Types.ObjectId | null; unitId: Types.ObjectId | null };
  balanceCents: number;
}

interface Row {
  propertyId: string | null;
  unitId: string | null;
  leaseId: string | null;
  label: string;
  balanceCents: number;
}

interface CountryGroup {
  country: string;
  totalCents: number;
  count: number;
  top: Row[];
}

const emptyPayload = { totalCents: 0, count: 0, top: [] as Row[], groups: [] as CountryGroup[] };

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
    return NextResponse.json(emptyPayload);
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
    return NextResponse.json(emptyPayload);
  }

  const totalCents = agg.reduce((acc, r) => acc + r.balanceCents, 0);
  const overallTop5 = agg.slice(0, 5);

  // 3. Fetch every property referenced by the aggregation — we need each one's
  //    country to build the per-country groups (not just the top 5).
  const allPropIds = Array.from(
    new Set(
      agg
        .map((r) => r._id.propertyId)
        .filter((p): p is Types.ObjectId => p instanceof Types.ObjectId)
        .map((p) => String(p)),
    ),
  ).map((s) => new Types.ObjectId(s));

  const props =
    allPropIds.length === 0
      ? []
      : await Property.find({ _id: { $in: allPropIds }, organizationId: orgId })
          .select({ _id: 1, propertyName: 1, propertySubType: 1, 'address.country': 1 })
          .lean();
  const propById = new Map(props.map((p) => [String(p._id), p]));

  const countryForRow = (r: AggRow): string => {
    const pKey = r._id.propertyId ? String(r._id.propertyId) : null;
    const prop = pKey ? propById.get(pKey) : null;
    if (!prop) return OTHER;
    return normalizeCountry(
      (prop as { address?: { country?: string } }).address?.country,
    );
  };

  // 4. Group all rows by country → totals + counts + that group's top 5.
  const groupMap = new Map<string, AggRow[]>();
  for (const r of agg) {
    const country = countryForRow(r);
    const list = groupMap.get(country) ?? [];
    list.push(r);
    groupMap.set(country, list);
  }

  // Rows we actually render (need Unit/Lease labels): overall top 5 ∪ each
  // group's top 5.
  const displayRows: AggRow[] = [...overallTop5];
  const groupTopSlices = new Map<string, AggRow[]>();
  groupMap.forEach((list, country) => {
    const slice = list.slice(0, 5);
    groupTopSlices.set(country, slice);
    displayRows.push(...slice);
  });

  // 5. Resolve labels for the rows we display. Units + Leases fetched in
  //    parallel; missing references fall back to a placeholder string.
  const unitIds = Array.from(
    new Set(
      displayRows
        .map((r) => r._id.unitId)
        .filter((u): u is Types.ObjectId => u instanceof Types.ObjectId)
        .map((u) => String(u)),
    ),
  ).map((s) => new Types.ObjectId(s));

  const [units, leases] = await Promise.all([
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

  const unitById = new Map(units.map((u) => [String(u._id), u]));
  const leaseByUnit = new Map<string, { _id: unknown }>();
  for (const l of leases) {
    const key = String(l.unitId);
    if (!leaseByUnit.has(key)) leaseByUnit.set(key, l);
  }

  const toRow = (row: AggRow): Row => {
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
  };

  const top = overallTop5.map(toRow);

  const groups: CountryGroup[] = Array.from(groupMap.entries()).map(
    ([country, list]) => ({
      country,
      totalCents: list.reduce((acc, r) => acc + r.balanceCents, 0),
      count: list.length,
      top: (groupTopSlices.get(country) ?? []).map(toRow),
    }),
  );

  // Sort groups by total desc, but always keep "Other" last.
  groups.sort((a, b) => {
    if (a.country === OTHER) return 1;
    if (b.country === OTHER) return -1;
    return b.totalCents - a.totalCents;
  });

  return NextResponse.json({
    totalCents,
    count: agg.length,
    top,
    groups,
  });
}
