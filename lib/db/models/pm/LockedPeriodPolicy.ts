// LockedPeriodPolicy — accounting period lock window (PDR_MASTER §3.27,
// BR-AC-3). Ordinary users cannot create/edit/void a JE, Deposit, Bill, or
// BillPayment dated inside an active policy window; FinancialAdministrator
// (or Admin) can override.
//
// Phase 2 ships the schema + admin CRUD + the `assertWriteAllowed` helper
// invoked by every accounting write path. The time-bounded override token
// referenced in [G-S-37] is deferred — role-based override is sufficient
// until audit-trail telemetry says otherwise.
import { Schema, model, models, Types, type Model } from 'mongoose';
import type { LockedPeriodScope } from '@/types/pm';

export const LOCKED_PERIOD_SCOPES: LockedPeriodScope[] = [
  'Global',
  'Per-property',
];

export interface ILockedPeriodPolicy {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  scope: LockedPeriodScope;
  propertyId?: Types.ObjectId | null;
  fromDate?: Date | null;
  toDate?: Date | null;
  message?: string;
  active: boolean;
  createdByUserId: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const LockedPeriodPolicySchema = new Schema<ILockedPeriodPolicy>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'PmOrganization',
      required: true,
    },
    scope: {
      type: String,
      enum: LOCKED_PERIOD_SCOPES,
      required: true,
      default: 'Global',
    },
    propertyId: {
      type: Schema.Types.ObjectId,
      ref: 'PmProperty',
      default: null,
    },
    fromDate: { type: Date, default: null },
    toDate: { type: Date, default: null },
    message: { type: String, trim: true, maxlength: 500 },
    active: { type: Boolean, default: true },
    createdByUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  { timestamps: true, collection: 'pm_locked_period_policies' },
);

LockedPeriodPolicySchema.index({
  organizationId: 1,
  active: 1,
  scope: 1,
  propertyId: 1,
});

LockedPeriodPolicySchema.pre('validate', function (next) {
  if (this.scope === 'Per-property' && !this.propertyId) {
    return next(
      new Error('Per-property locked periods require a propertyId.'),
    );
  }
  if (this.scope === 'Global' && this.propertyId) {
    return next(
      new Error('Global locked periods must not carry a propertyId.'),
    );
  }
  if (this.fromDate && this.toDate && this.fromDate > this.toDate) {
    return next(new Error('Locked period: fromDate must be on or before toDate.'));
  }
  next();
});

export const LockedPeriodPolicy: Model<ILockedPeriodPolicy> =
  (models.PmLockedPeriodPolicy as Model<ILockedPeriodPolicy>) ??
  model<ILockedPeriodPolicy>(
    'PmLockedPeriodPolicy',
    LockedPeriodPolicySchema,
  );

export default LockedPeriodPolicy;
