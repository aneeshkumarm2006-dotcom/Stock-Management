// Propagate a tenant's identity into the denormalized snapshots that Lease and
// DraftLease keep inside their `tenants[]` / `cosigners[]` arrays.
//
// Why this exists: leases and draft leases store a point-in-time copy of each
// tenant's display identity (tenantType, first/last name, companyName, email)
// so rent-roll / lease-detail / unit-detail / compose-email can render names
// without a per-row join (see Lease.ts ILeaseTenantRef, DraftLease.ts
// IDraftLeaseTenantRef, and leasingPromotion.ts which stamps them on promotion).
// Nothing re-synced those snapshots when the live Tenant doc was edited, so
// changing a tenant's type (e.g. Individual ⇒ Company) would update the tenant
// pages but leave the rent roll showing the old personal name. This helper is
// called from PATCH /api/pm/tenants/[id] after a successful save whenever an
// identity field changed, so every surface reflects the change immediately.
//
// Snapshots are display denormalization only, so we update leases of every
// status (Active/Future/Expired/Ended/Cancelled) and all drafts for a fully
// consistent directory. The `$set` runs through `updateMany`, which bypasses
// document validation hooks — that's intentional; we are syncing already-valid
// fields off the canonical Tenant doc.
import { Types, type Model } from 'mongoose';
import { Lease } from '@/lib/db/models/pm/Lease';
import { DraftLease } from '@/lib/db/models/pm/DraftLease';
import type { TenantType } from '@/types/pm';

/** The minimal shape of a saved Tenant doc this helper needs. */
export interface TenantSnapshotSource {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  tenantType?: TenantType;
  firstName?: string;
  lastName?: string;
  companyName?: string;
  email?: string;
}

export interface TenantSyncResult {
  /** Lease + DraftLease documents that had at least one matching ref updated. */
  matched: number;
  modified: number;
}

// The two embedded arrays that carry tenant snapshots, on both collections.
const REF_ARRAYS = ['tenants', 'cosigners'] as const;

/**
 * Re-stamp the identity snapshot for `tenant` across every Lease and DraftLease
 * ref (tenant or cosigner) that points at it, scoped to the tenant's org.
 * Safe to call after any tenant edit — it is a no-op when no lease references
 * the tenant.
 */
export async function syncTenantSnapshots(
  tenant: TenantSnapshotSource,
): Promise<TenantSyncResult> {
  const tenantId = tenant._id;
  const orgId = tenant.organizationId;

  // Canonicalize the snapshot off the live doc. Empty strings (not undefined)
  // clear the off-type field so a converted tenant can't keep a stale value —
  // e.g. an Individual's snapshot must not retain an old companyName. The
  // display helper (tenantDisplayName) treats '' as absent.
  const snapshot = {
    tenantType: (tenant.tenantType ?? 'Individual') as TenantType,
    firstName: tenant.firstName ?? '',
    lastName: tenant.lastName ?? '',
    companyName: tenant.companyName ?? '',
    email: tenant.email ?? '',
  };

  // One updateMany per (collection, array) so each uses a single positional
  // arrayFilter against a query that guarantees the element exists. Avoids the
  // edge cases of referencing two arrayFilters in one update when a given doc
  // only contains one of the arrays.
  const ops: Promise<{ matchedCount: number; modifiedCount: number }>[] = [];
  for (const model of [Lease, DraftLease] as Model<unknown>[]) {
    for (const field of REF_ARRAYS) {
      ops.push(
        model
          .updateMany(
            { organizationId: orgId, [`${field}.tenantId`]: tenantId },
            {
              $set: {
                [`${field}.$[ref].tenantType`]: snapshot.tenantType,
                [`${field}.$[ref].firstName`]: snapshot.firstName,
                [`${field}.$[ref].lastName`]: snapshot.lastName,
                [`${field}.$[ref].companyName`]: snapshot.companyName,
                [`${field}.$[ref].email`]: snapshot.email,
              },
            },
            { arrayFilters: [{ 'ref.tenantId': tenantId }] },
          )
          .then((r) => ({
            matchedCount: r.matchedCount ?? 0,
            modifiedCount: r.modifiedCount ?? 0,
          })),
      );
    }
  }

  const results = await Promise.all(ops);
  return {
    matched: results.reduce((s, r) => s + r.matchedCount, 0),
    modified: results.reduce((s, r) => s + r.modifiedCount, 0),
  };
}
