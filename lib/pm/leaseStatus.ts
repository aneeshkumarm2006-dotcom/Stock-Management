// Lease status helpers (Phase 3). The Lease model persists `status` for fast
// filtering on the rent-roll's default `(2) Active, Future` chip (BR-LL-2),
// but the canonical truth is date-driven. These helpers keep persisted values
// honest:
//   - `computeLeaseStatus()` derives the status a row *should* carry given
//     today's date, honouring the manual terminal states (Ended | Cancelled).
//   - `daysRemaining()` powers the 90-day orange chip (BR-LL-5).
//   - `recomputeLeaseStatuses(orgId)` is a mass-update entrypoint a future
//     nightly cron will call (TODO Phase 6); routes can also invoke it after
//     a status-touching write to keep `Tenant.currentLeaseId` in sync.
//
// `Tenant.currentLeaseId` (added in Phase 3) follows the lease lifecycle:
// set on the Active lease the tenant lives on, cleared when the lease moves
// to Ended/Expired/Cancelled, also kept in sync on bulk recomputes here.
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import {
  Lease,
  daysRemainingForChip,
  deriveLeaseStatus,
  type ILease,
} from '@/lib/db/models/pm/Lease';
import { Tenant } from '@/lib/db/models/pm/Tenant';
import type { LeaseStatus } from '@/types/pm';

export interface ComputeLeaseStatusInput {
  startDate: Date | string | null | undefined;
  endDate: Date | string | null | undefined;
  leaseType: ILease['leaseType'];
  /** Manual override — `Ended` / `Cancelled` short-circuit derivation. */
  manual?: LeaseStatus;
}

/** Wraps `deriveLeaseStatus` and the manual terminal-state escape hatch. */
export function computeLeaseStatus(input: ComputeLeaseStatusInput): LeaseStatus {
  if (input.manual === 'Ended' || input.manual === 'Cancelled') {
    return input.manual;
  }
  const startDate = input.startDate ? new Date(input.startDate) : null;
  const endDate = input.endDate ? new Date(input.endDate) : null;
  return deriveLeaseStatus({
    status: input.manual ?? 'Active',
    startDate: startDate as Date,
    endDate,
    leaseType: input.leaseType,
  });
}

/** Returns the day count for the BR-LL-5 orange chip, or `null` when the
 *  chip should not render (At-will, past endDate, or > 90 days out). */
export function daysRemaining(
  lease: Pick<ILease, 'endDate' | 'leaseType'>,
): number | null {
  return daysRemainingForChip(lease);
}

export interface RecomputeResult {
  scanned: number;
  updated: number;
  tenantsTouched: number;
}

/**
 * Mass-updater across all non-terminal leases for an org. Recomputes each
 * lease's `status` from dates and patches `Tenant.currentLeaseId` to match.
 *
 * TODO Phase 6 — wire to a nightly cron at 02:00 org-tz. For now callers
 * trigger it from Phase 3 routes (DraftLease execute, eviction toggle,
 * end-of-month sweep button on rent roll). Idempotent and safe to run
 * repeatedly.
 */
export async function recomputeLeaseStatuses(
  orgId: string,
): Promise<RecomputeResult> {
  await connectToDatabase();
  const orgObjectId = new Types.ObjectId(orgId);

  const leases = await Lease.find({
    organizationId: orgObjectId,
    status: { $in: ['Active', 'Future', 'Expired'] },
  });

  let updated = 0;
  let tenantsTouched = 0;

  for (const lease of leases) {
    const next = computeLeaseStatus({
      startDate: lease.startDate,
      endDate: lease.endDate,
      leaseType: lease.leaseType,
      manual: lease.status,
    });
    if (next !== lease.status) {
      lease.status = next;
      await lease.save();
      updated += 1;
    }

    // Tenant.currentLeaseId sync. Active → point at this lease. Terminal →
    // clear when it pointed here.
    const tenantIds = lease.tenants
      .map((t) => t.tenantId)
      .filter((v): v is Types.ObjectId => Boolean(v));
    if (tenantIds.length === 0) continue;

    if (next === 'Active') {
      const res = await Tenant.updateMany(
        {
          organizationId: orgObjectId,
          _id: { $in: tenantIds },
          $or: [
            { currentLeaseId: null },
            { currentLeaseId: { $exists: false } },
            { currentLeaseId: lease._id },
          ],
        },
        { $set: { currentLeaseId: lease._id } },
      );
      tenantsTouched += res.modifiedCount;
    } else if (
      next === 'Ended' ||
      next === 'Cancelled' ||
      next === 'Expired'
    ) {
      const res = await Tenant.updateMany(
        {
          organizationId: orgObjectId,
          _id: { $in: tenantIds },
          currentLeaseId: lease._id,
        },
        { $set: { currentLeaseId: null } },
      );
      tenantsTouched += res.modifiedCount;
    }
  }

  return { scanned: leases.length, updated, tenantsTouched };
}
