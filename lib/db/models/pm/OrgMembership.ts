// OrgMembership — User ↔ Organization junction with role flags.
// One row per (org, user). `Admin` is a super-role and implies all others
// (DECISIONS.md [G-B-22]).
// Refs: PROPERTY_TODO.md Phase 0 §Auth & User; BR-AC-3 (FinancialAdministrator
// override on locked periods).
import { Schema, model, models, Types, type Model } from 'mongoose';
import type { OrgRole } from '@/types/pm';

const ORG_ROLES: OrgRole[] = [
  'Admin',
  'PropertyManager',
  'Accountant',
  'FinancialAdministrator',
];

export interface IOrgMembership {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  userId: Types.ObjectId;
  roles: OrgRole[];
  invitedAt?: Date;
  joinedAt: Date;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const OrgMembershipSchema = new Schema<IOrgMembership>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'PmOrganization',
      required: true,
    },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    roles: {
      type: [String],
      enum: ORG_ROLES,
      required: true,
      default: ['PropertyManager'],
    },
    invitedAt: { type: Date },
    joinedAt: { type: Date, default: () => new Date() },
    active: { type: Boolean, default: true },
  },
  { timestamps: true, collection: 'pm_org_memberships' },
);

OrgMembershipSchema.index(
  { organizationId: 1, userId: 1 },
  { unique: true },
);
OrgMembershipSchema.index({ userId: 1 });

export const OrgMembership: Model<IOrgMembership> =
  (models.PmOrgMembership as Model<IOrgMembership>) ??
  model<IOrgMembership>('PmOrgMembership', OrgMembershipSchema);

export default OrgMembership;
