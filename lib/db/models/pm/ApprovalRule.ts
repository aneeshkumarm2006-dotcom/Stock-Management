// ApprovalRule — multi-approver EFT gate (PDR_MASTER BR-AC-19, [G-S-31]).
//
// One rule per (org, scope, scopeId) → governs which approvers must sign
// an EFT before it posts to the GL. Phase 4 ships a single-approver flow
// (anyone with `FinancialAdministrator` clicks Approve and the JE drops);
// Phase 9 layers this rule engine on top.
//
// Evaluation order at approval time:
//   1. Find the most-specific Property-scope rule matching the EFT (via the
//      EFT's billId → bill.scope.id when scope=Property).
//   2. Else fall back to the Company-scope rule.
//   3. Else the legacy single-approver flow runs (Phase 4 baseline).
//
// Threshold: applies in dollars (stored as cents internally for math
// consistency). EFTs below the threshold skip the rule entirely.
//
// Semantics:
//   - `any-of` — first approver in `approverUserIds` to click Approve
//                completes the rule.
//   - `all-of` — every approver in `approverUserIds` must sign; the EFT
//                stays in Pending until the set is complete.
import { Schema, model, models, Types, type Model } from 'mongoose';
import type {
  ApprovalRuleScopeType,
  ApprovalRuleSemantics,
} from '@/types/pm';

export const APPROVAL_RULE_SCOPE_TYPES_DB: ApprovalRuleScopeType[] = [
  'Company',
  'Property',
];

export const APPROVAL_RULE_SEMANTICS_DB: ApprovalRuleSemantics[] = [
  'any-of',
  'all-of',
];

export interface IApprovalRule {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  scopeType: ApprovalRuleScopeType;
  /** Property._id when scope=Property; null when scope=Company. */
  scopeId?: Types.ObjectId | null;
  /** Threshold in integer cents. EFTs strictly below this amount skip the rule. */
  thresholdCents: number;
  semantics: ApprovalRuleSemantics;
  approverUserIds: Types.ObjectId[];
  active: boolean;
  createdByUserId: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const ApprovalRuleSchema = new Schema<IApprovalRule>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'PmOrganization',
      required: true,
    },
    scopeType: {
      type: String,
      enum: APPROVAL_RULE_SCOPE_TYPES_DB,
      required: true,
      default: 'Company',
    },
    scopeId: { type: Schema.Types.ObjectId, default: null },
    thresholdCents: { type: Number, required: true, min: 0, default: 0 },
    semantics: {
      type: String,
      enum: APPROVAL_RULE_SEMANTICS_DB,
      required: true,
      default: 'any-of',
    },
    approverUserIds: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    active: { type: Boolean, default: true },
    createdByUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  { timestamps: true, collection: 'pm_approval_rules' },
);

// One active rule per (org, scope, scopeId). Property-scope rules require
// scopeId; Company-scope rules use null. Partial filter scopes the unique
// to active rows so deactivated rules can coexist.
ApprovalRuleSchema.index(
  { organizationId: 1, scopeType: 1, scopeId: 1 },
  {
    unique: true,
    partialFilterExpression: { active: true },
  },
);

ApprovalRuleSchema.pre('validate', function (next) {
  if (this.scopeType === 'Property' && !this.scopeId) {
    return next(new Error('Property-scope ApprovalRule requires scopeId.'));
  }
  if (this.scopeType === 'Company' && this.scopeId) {
    return next(new Error('Company-scope ApprovalRule must not carry scopeId.'));
  }
  if (!this.approverUserIds || this.approverUserIds.length === 0) {
    return next(new Error('ApprovalRule requires at least one approver.'));
  }
  next();
});

export const ApprovalRule: Model<IApprovalRule> =
  (models.PmApprovalRule as Model<IApprovalRule>) ??
  model<IApprovalRule>('PmApprovalRule', ApprovalRuleSchema);

export default ApprovalRule;
