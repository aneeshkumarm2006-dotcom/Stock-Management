// RentersInsurancePolicy — coverage record attached to a Lease (PDR §3.31).
// Drives Dashboard `Renters Insurance` donut + `Expiring` card, plus the
// Lease-level `uninsuredResidents` derived list (BR-LL-6).
//
// Property-level min liability fields (3rd-party + MSI) live on Property and
// are enforced by the route on save — if `liabilityCoverage` falls below the
// matching threshold for the carrier the policy still saves but a warning is
// returned in the response payload (Phase 3 keeps the door open for
// underwriting workflows).
//
// `coveredResidents[]` is a many-to-many flag against Tenant rows attached
// to the lease. When the policy is created with `coveredResidents=[]` ALL
// tenants on the lease are considered covered; an explicit list narrows
// coverage and drives the uninsured-residents roll-up.
import { Schema, model, models, Types, type Model } from 'mongoose';
import type { RentersInsuranceCarrier } from '@/types/pm';
import { RENTERS_INSURANCE_CARRIERS } from '@/types/pm';

export interface IRentersInsurancePolicy {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  leaseId: Types.ObjectId;
  carrier: RentersInsuranceCarrier;
  policyNumber?: string;
  liabilityCoverage: number; // cents
  effectiveDate: Date;
  expirationDate: Date;
  /** Empty array = all tenants on the lease are covered. */
  coveredResidents: Types.ObjectId[];
  documentFileId?: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const RentersInsurancePolicySchema = new Schema<IRentersInsurancePolicy>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'PmOrganization',
      required: true,
    },
    leaseId: {
      type: Schema.Types.ObjectId,
      ref: 'PmLease',
      required: true,
    },
    carrier: {
      type: String,
      enum: RENTERS_INSURANCE_CARRIERS,
      required: true,
    },
    policyNumber: { type: String, trim: true, maxlength: 80 },
    liabilityCoverage: { type: Number, required: true, min: 0 },
    effectiveDate: { type: Date, required: true },
    expirationDate: { type: Date, required: true },
    coveredResidents: {
      type: [{ type: Schema.Types.ObjectId, ref: 'PmTenant' }],
      default: [],
    },
    documentFileId: {
      type: Schema.Types.ObjectId,
      ref: 'PmFile',
      default: null,
    },
  },
  { timestamps: true, collection: 'pm_renters_insurance_policies' },
);

RentersInsurancePolicySchema.index({
  organizationId: 1,
  leaseId: 1,
  expirationDate: -1,
});
RentersInsurancePolicySchema.index({
  organizationId: 1,
  expirationDate: 1,
});

RentersInsurancePolicySchema.pre('validate', function (next) {
  if (this.effectiveDate && this.expirationDate &&
      this.expirationDate <= this.effectiveDate) {
    return next(
      new Error('expirationDate must be later than effectiveDate.'),
    );
  }
  next();
});

export const RentersInsurancePolicy: Model<IRentersInsurancePolicy> =
  (models.PmRentersInsurancePolicy as Model<IRentersInsurancePolicy>) ??
  model<IRentersInsurancePolicy>(
    'PmRentersInsurancePolicy',
    RentersInsurancePolicySchema,
  );

export default RentersInsurancePolicy;
