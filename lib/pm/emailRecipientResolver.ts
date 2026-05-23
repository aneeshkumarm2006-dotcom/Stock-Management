// Recipient resolution for the Compose Email workflow (Phase 6, PDR §3.35).
//
// The Compose modal sends polymorphic recipients (Tenant id, Property id …);
// the server resolves them into a flat list of `{ email, name }` entries that
// EmailMessage persists. `Property` expands to every active Tenant on the
// Property (BR-CC-8 analogue from CalendarEvents). `Lease` expands to all
// active Tenants on that Lease.
//
// We keep this server-side: clients never see another tenant's email address
// before resolution (impersonation + multi-tenant isolation per Phase 0).
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { Tenant } from '@/lib/db/models/pm/Tenant';
import { RentalOwner } from '@/lib/db/models/pm/RentalOwner';
import { Vendor } from '@/lib/db/models/pm/Vendor';
import { Applicant } from '@/lib/db/models/pm/Applicant';
import { Lease } from '@/lib/db/models/pm/Lease';
import type { EmailRecipientType } from '@/types/pm';

export interface ResolvedRecipient {
  type: EmailRecipientType;
  id: Types.ObjectId | null;
  email: string;
  name?: string;
}

export interface RecipientInput {
  type: EmailRecipientType;
  id: string | null;
  email?: string;
  name?: string;
}

function toName(first?: string, last?: string, company?: string): string {
  if (company) return company;
  return [first, last].filter(Boolean).join(' ').trim();
}

/**
 * Resolve a single recipient ref into one or more concrete email/name pairs.
 * Returns `[]` when the entity has no email on file or the id doesn't match
 * this organization — callers must handle "no email" by surfacing a warning
 * in the Compose modal before send.
 */
export async function resolveRecipient(
  orgId: string,
  input: RecipientInput,
): Promise<ResolvedRecipient[]> {
  const org = new Types.ObjectId(orgId);

  switch (input.type) {
    case 'Custom': {
      if (!input.email) return [];
      return [
        {
          type: 'Custom',
          id: null,
          email: input.email.trim().toLowerCase(),
          name: input.name?.trim(),
        },
      ];
    }
    case 'Tenant': {
      if (!input.id || !Types.ObjectId.isValid(input.id)) return [];
      const doc = await Tenant.findOne({
        _id: new Types.ObjectId(input.id),
        organizationId: org,
      })
        .select('email firstName lastName')
        .lean();
      if (!doc?.email) return [];
      return [
        {
          type: 'Tenant',
          id: doc._id,
          email: doc.email,
          name: toName(doc.firstName, doc.lastName),
        },
      ];
    }
    case 'RentalOwner': {
      if (!input.id || !Types.ObjectId.isValid(input.id)) return [];
      const doc = await RentalOwner.findOne({
        _id: new Types.ObjectId(input.id),
        organizationId: org,
      })
        .select('primaryEmail firstName lastName isCompany companyName')
        .lean();
      const email = doc?.primaryEmail;
      if (!doc || !email) return [];
      return [
        {
          type: 'RentalOwner',
          id: doc._id,
          email,
          name: toName(
            doc.firstName,
            doc.lastName,
            doc.isCompany ? doc.companyName : undefined,
          ),
        },
      ];
    }
    case 'Vendor': {
      if (!input.id || !Types.ObjectId.isValid(input.id)) return [];
      const doc = await Vendor.findOne({
        _id: new Types.ObjectId(input.id),
        organizationId: org,
      })
        .select('primaryEmail firstName lastName isCompany companyName')
        .lean();
      const email = doc?.primaryEmail;
      if (!doc || !email) return [];
      return [
        {
          type: 'Vendor',
          id: doc._id,
          email,
          name: toName(
            doc.firstName,
            doc.lastName,
            doc.isCompany ? doc.companyName : undefined,
          ),
        },
      ];
    }
    case 'Applicant': {
      if (!input.id || !Types.ObjectId.isValid(input.id)) return [];
      const doc = await Applicant.findOne({
        _id: new Types.ObjectId(input.id),
        organizationId: org,
      })
        .select('email firstName lastName')
        .lean();
      if (!doc?.email) return [];
      return [
        {
          type: 'Applicant',
          id: doc._id,
          email: doc.email,
          name: toName(doc.firstName, doc.lastName),
        },
      ];
    }
    case 'Property': {
      if (!input.id || !Types.ObjectId.isValid(input.id)) return [];
      const propertyId = new Types.ObjectId(input.id);
      // Tenants don't carry a direct propertyId; resolve via Active leases on
      // the property, then union the tenant rosters. Cosigners are excluded —
      // BR-CC-8 analogue only blasts to active Tenants on the Property.
      const activeLeases = await Lease.find({
        organizationId: org,
        propertyId,
        status: { $in: ['Active', 'Future'] },
      })
        .select('tenants')
        .lean();
      const tenantIdSet = new Set<string>();
      for (const lease of activeLeases) {
        for (const t of (lease.tenants ?? []) as Array<{ tenantId: Types.ObjectId }>) {
          if (t.tenantId) tenantIdSet.add(String(t.tenantId));
        }
      }
      if (tenantIdSet.size === 0) return [];
      const tenants = await Tenant.find({
        organizationId: org,
        _id: { $in: Array.from(tenantIdSet).map((id) => new Types.ObjectId(id)) },
        active: true,
        email: { $exists: true, $ne: '' },
      })
        .select('_id email firstName lastName')
        .lean();
      return tenants
        .filter((t) => !!t.email)
        .map((t) => ({
          type: 'Tenant' as const,
          id: t._id,
          email: t.email as string,
          name: toName(t.firstName, t.lastName),
        }));
    }
    case 'Lease': {
      if (!input.id || !Types.ObjectId.isValid(input.id)) return [];
      const leaseId = new Types.ObjectId(input.id);
      const lease = await Lease.findOne({
        _id: leaseId,
        organizationId: org,
      })
        .select('tenants')
        .lean();
      if (!lease) return [];
      const tenantIds = ((lease.tenants ?? []) as Array<{
        tenantId: Types.ObjectId;
      }>)
        .map((t) => t.tenantId)
        .filter(Boolean);
      if (tenantIds.length === 0) return [];
      const tenants = await Tenant.find({
        organizationId: org,
        _id: { $in: tenantIds },
        email: { $exists: true, $ne: '' },
      })
        .select('_id email firstName lastName')
        .lean();
      return tenants
        .filter((t) => !!t.email)
        .map((t) => ({
          type: 'Tenant' as const,
          id: t._id,
          email: t.email as string,
          name: toName(t.firstName, t.lastName),
        }));
    }
    default:
      return [];
  }
}

/**
 * Resolve a list of recipient refs in order, deduplicated by email. The
 * EmailMessage POST handler calls this for `to`, `cc`, and `bcc`.
 */
export async function resolveRecipients(
  orgId: string,
  inputs: RecipientInput[],
): Promise<ResolvedRecipient[]> {
  await connectToDatabase();
  const out: ResolvedRecipient[] = [];
  const seen = new Set<string>();
  for (const input of inputs) {
    const resolved = await resolveRecipient(orgId, input);
    for (const r of resolved) {
      const key = r.email.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(r);
    }
  }
  return out;
}
