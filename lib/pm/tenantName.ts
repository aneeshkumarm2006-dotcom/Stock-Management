// Shared tenant display-name resolver (changes.md §1 — Company tenants).
// A tenant — or a denormalized lease/draft tenant ref — renders as the
// company name when it is a Company, and as "First Last" otherwise. Kept in
// one place so every surface (tenants list, rent roll, lease/unit detail,
// pickers) shows the same label and falls back gracefully on legacy rows that
// predate the company fields.
import type { TenantType } from '@/types/pm';

export interface TenantNameParts {
  tenantType?: TenantType | null;
  companyName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
}

/** Resolve the human label for a tenant or lease tenant ref. Falls back to the
 *  personal name when a Company is missing its `companyName`, and to the
 *  company name when an Individual snapshot has no personal name. */
export function tenantDisplayName(t: TenantNameParts): string {
  const company = (t.companyName ?? '').trim();
  const personal = `${t.firstName ?? ''} ${t.lastName ?? ''}`.trim();
  if (t.tenantType === 'Company') return company || personal;
  return personal || company;
}
