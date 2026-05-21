// Org-role helpers (DECISIONS.md [G-B-22]). `Admin` is a super-role and
// implies every other role.
// Refs: BR-AC-3 (FinancialAdministrator override on locked periods).
import type { OrgRole } from '@/types/pm';

interface RolesCarrier {
  roles?: OrgRole[];
}

/** True iff the session carries `role` or `Admin`. */
export function hasRole(carrier: RolesCarrier | null | undefined, role: OrgRole): boolean {
  const roles = carrier?.roles ?? [];
  if (roles.includes('Admin')) return true;
  return roles.includes(role);
}

/** BR-AC-3 — only Financial Administrators (or Admins) can write into a
 * locked accounting period. */
export function canOverrideLockedPeriod(
  carrier: RolesCarrier | null | undefined,
): boolean {
  return hasRole(carrier, 'FinancialAdministrator');
}

export function canManageOrg(carrier: RolesCarrier | null | undefined): boolean {
  return hasRole(carrier, 'Admin');
}

export function canImpersonate(carrier: RolesCarrier | null | undefined): boolean {
  return hasRole(carrier, 'Admin');
}
