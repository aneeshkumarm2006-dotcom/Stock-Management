// Phase 9 approval-rule resolution (BR-AC-19, [G-S-31]). Called from the
// EFT create + approve routes to (a) snapshot the rule onto the EFT and
// (b) decide whether the EFT can post to the GL.
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { ApprovalRule, type IApprovalRule } from '@/lib/db/models/pm/ApprovalRule';
import { Bill } from '@/lib/db/models/pm/Bill';
import type { ApprovalRuleSemantics } from '@/types/pm';

export interface ResolvedApprovalRule {
  ruleId: Types.ObjectId;
  semantics: ApprovalRuleSemantics;
  approverUserIds: Types.ObjectId[];
}

/**
 * Resolve the most-specific active ApprovalRule for an EFT.
 *
 * Order:
 *   1. Property-scope rule keyed off the linked Bill's scope.
 *   2. Company-scope rule.
 *   3. null (Phase 4 single-approver fallback).
 *
 * Returns null when no rule applies OR when `amountCents` is strictly below
 * the matched rule's `thresholdCents` (i.e. low-dollar EFTs skip the rule).
 */
export async function resolveApprovalRule(input: {
  orgId: string;
  amountCents: number;
  billId?: string | Types.ObjectId | null;
}): Promise<ResolvedApprovalRule | null> {
  await connectToDatabase();
  const orgObjectId = new Types.ObjectId(input.orgId);

  let propertyId: Types.ObjectId | null = null;
  if (input.billId) {
    const billIdObj =
      typeof input.billId === 'string'
        ? new Types.ObjectId(input.billId)
        : input.billId;
    const bill = await Bill.findOne({
      _id: billIdObj,
      organizationId: orgObjectId,
    }).lean<{ scope?: { type?: string; id?: Types.ObjectId | null } } | null>();
    if (bill?.scope?.type === 'Property' && bill.scope.id) {
      propertyId = bill.scope.id;
    }
  }

  const candidates: IApprovalRule[] = await ApprovalRule.find({
    organizationId: orgObjectId,
    active: true,
    $or: [
      { scopeType: 'Company', scopeId: null },
      ...(propertyId
        ? [{ scopeType: 'Property', scopeId: propertyId }]
        : []),
    ],
  })
    .sort({ scopeType: 1 }) // 'Company' < 'Property' alphabetically — prefer 'Property' below
    .lean<IApprovalRule[]>();

  // Prefer the Property-scope hit when it exists.
  const propertyRule = candidates.find((r) => r.scopeType === 'Property');
  const companyRule = candidates.find((r) => r.scopeType === 'Company');
  const rule = propertyRule ?? companyRule ?? null;

  if (!rule) return null;
  if (input.amountCents < rule.thresholdCents) return null;

  return {
    ruleId: rule._id,
    semantics: rule.semantics,
    approverUserIds: rule.approverUserIds.map((id) =>
      typeof id === 'string' ? new Types.ObjectId(id) : id,
    ),
  };
}

/**
 * Decide whether an EFT has accumulated enough approvals to post.
 *
 * - No rule snapshot → defer to legacy single-approver flow (caller decides).
 * - `any-of`         → first approval clears it.
 * - `all-of`         → every required approver must be in receivedApprovals.
 */
export function isApprovalThresholdMet(
  semantics: ApprovalRuleSemantics | null | undefined,
  requiredApproverUserIds: Types.ObjectId[],
  receivedApprovals: { userId: Types.ObjectId }[],
): boolean {
  if (!semantics || requiredApproverUserIds.length === 0) return true;
  const receivedSet = new Set(
    receivedApprovals.map((a) => String(a.userId)),
  );
  if (semantics === 'any-of') {
    return requiredApproverUserIds.some((id) => receivedSet.has(String(id)));
  }
  return requiredApproverUserIds.every((id) => receivedSet.has(String(id)));
}

/** True when a user is permitted to add their signature to a pending EFT. */
export function userCanApprove(
  userId: string,
  requiredApproverUserIds: Types.ObjectId[],
): boolean {
  if (requiredApproverUserIds.length === 0) return true; // legacy flow
  return requiredApproverUserIds.some((id) => String(id) === userId);
}
