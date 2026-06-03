// Locked-period write enforcement (BR-AC-3). Every accounting write path
// (JournalEntry, Deposit, future Bill/BillPayment) calls `assertWriteAllowed`
// before touching the DB. Ordinary users are blocked when the txn date falls
// inside an active LockedPeriodPolicy window; FinancialAdministrator (or
// Admin) callers override.
//
// Open-ended bounds: `fromDate=null` means "always blocked up to toDate";
// `toDate=null` means "blocked from fromDate forward". Both null is unusual
// but treated as "always blocked while active=true" (admins can override).
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { LockedPeriodPolicy } from '@/lib/db/models/pm/LockedPeriodPolicy';
import { OrgMembership } from '@/lib/db/models/pm/OrgMembership';
import { canOverrideLockedPeriod } from '@/lib/pm/roles';
import type { PmContext } from '@/lib/auth/getCurrentUser';

export class LockedPeriodError extends Error {
  readonly status = 423 as const;
  readonly policyId: string;
  readonly policyMessage: string;
  constructor(opts: { policyId: string; policyMessage: string }) {
    super(opts.policyMessage || 'Transaction date falls inside a locked period.');
    this.name = 'LockedPeriodError';
    this.policyId = opts.policyId;
    this.policyMessage =
      opts.policyMessage || 'Transaction date falls inside a locked period.';
  }
}

export interface AssertWriteAllowedInput {
  orgId: string;
  /** Transaction date being written. */
  txnDate: Date;
  /** The Property scope of the line (if any). Used to match Per-property
   * policies. Global policies match regardless. */
  scopePropertyId?: string | null;
  ctx: PmContext;
}

/**
 * Resolve whether the caller may override locked periods.
 *
 * DEL-020 — under impersonation (`ctx.impersonatedBy` set) the override role
 * must be evaluated against the ACTING ADMIN, not the impersonated user.
 * Policy: the acting admin RETAINS their override capability while signed in
 * as another user (an impersonating Admin/FinancialAdministrator can still
 * write into a locked period). We resolve the acting admin's roles fresh from
 * OrgMembership rather than trusting the (impersonated) session roles.
 */
export async function resolveCanOverrideLockedPeriod(
  ctx: PmContext,
  orgId: string,
): Promise<boolean> {
  // Non-impersonated path: the session roles ARE the acting user's roles.
  if (!ctx.impersonatedBy) {
    return canOverrideLockedPeriod(ctx);
  }
  // Impersonating: resolve the acting admin's membership for this org.
  if (
    !Types.ObjectId.isValid(ctx.impersonatedBy) ||
    !Types.ObjectId.isValid(orgId)
  ) {
    return false;
  }
  await connectToDatabase();
  const membership = await OrgMembership.findOne({
    organizationId: new Types.ObjectId(orgId),
    userId: new Types.ObjectId(ctx.impersonatedBy),
    active: true,
  })
    .select({ roles: 1 })
    .lean<{ roles: PmContext['roles'] } | null>();
  return canOverrideLockedPeriod({ roles: membership?.roles ?? [] });
}

/**
 * Throws LockedPeriodError when a matching active policy covers `txnDate` and
 * the caller cannot override. No-op otherwise.
 */
export async function assertWriteAllowed(
  input: AssertWriteAllowedInput,
): Promise<void> {
  if (await resolveCanOverrideLockedPeriod(input.ctx, input.orgId)) return;

  await connectToDatabase();
  const orgObjectId = new Types.ObjectId(input.orgId);

  // Global and Per-bank-account policies match regardless of the line's
  // property scope (a recon lock on one bank is bounded by its own
  // fromDate/toDate window — DEL-002 — so unrelated banks' history stays
  // writable). Per-property policies only match the line's own property.
  const scopeClauses: Record<string, unknown>[] = [
    { scope: 'Global' },
    { scope: 'Per-bank-account' },
  ];
  if (input.scopePropertyId && Types.ObjectId.isValid(input.scopePropertyId)) {
    scopeClauses.push({
      scope: 'Per-property',
      propertyId: new Types.ObjectId(input.scopePropertyId),
    });
  }

  const candidates = await LockedPeriodPolicy.find({
    organizationId: orgObjectId,
    active: true,
    $or: scopeClauses,
  }).lean();

  for (const policy of candidates) {
    const fromOk = !policy.fromDate || input.txnDate >= policy.fromDate;
    const toOk = !policy.toDate || input.txnDate <= policy.toDate;
    if (fromOk && toOk) {
      throw new LockedPeriodError({
        policyId: String(policy._id),
        policyMessage:
          policy.message ??
          'This date falls inside a locked accounting period.',
      });
    }
  }
}
