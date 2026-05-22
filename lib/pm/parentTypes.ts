// Polymorphic parent enums shared by Note, ActivityLogEntry, and PmFile.
// Note + ActivityLogEntry parents are the PARENT_TYPES set; PmFile adds
// `Account` for account-level uploads (PDR_MASTER §3.29 — Buildium parity:
// `Upload account file` permits a File without a Location).
// Each phase extends both sets as new entities ship — keep this file the
// single source of truth.

import { z } from "zod";

/**
 * Polymorphic parent for Note + ActivityLogEntry. Phase 2 adds the accounting
 * entities so JE/Deposit/locked-period mutations get a real audit-log parent
 * (previously they piggy-backed on `Task` as a placeholder).
 */
export const PARENT_TYPES = [
  // Phase 0/1 — rentals + tasks
  "Property",
  "Unit",
  "Lease",
  "Tenant",
  "RentalOwner",
  "Vendor",
  "WorkOrder",
  "Applicant",
  "Listing",
  "Task",
  // Phase 2 — accounting entities
  "BankAccount",
  "ChartOfAccount",
  "JournalEntry",
  "Deposit",
  "LockedPeriodPolicy",
  "CompanyAccount",
  // Phase 3 — leasing-lifecycle entities (Lease, Tenant, Applicant, Listing
  // already covered; the rest are new). DraftLease lives in its own URL space
  // (BR-LL-8) but writes notes/activity/files against the same parent slot
  // so a draft → active promotion preserves history.
  "Prospect",
  "DraftLease",
  "RentersInsurancePolicy",
  "Pet",
  // Phase 4 — Maintenance + A/P entities (Vendor, WorkOrder, Task already
  // covered above as Phase 0/1 reservations). CalendarEvent stub ships here
  // for BR-MV-7 so WorkOrder → schedule-event has a real parent to write
  // against; full surface in Phase 7.
  "Bill",
  "BillPayment",
  "RecurringTransaction",
  "EftRequest",
  "CalendarEvent",
] as const;

/**
 * File locations — superset of PARENT_TYPES with `Account` for account-level
 * uploads (no parent). Phase 2 adds JournalEntry + Deposit so attachments land
 * on the right entity.
 */
export const FILE_LOCATION_TYPES = [
  ...PARENT_TYPES,
  "Account",
] as const;

export const parentTypeSchema = z.enum(PARENT_TYPES);
export const fileLocationTypeSchema = z.enum(FILE_LOCATION_TYPES);

/**
 * Entities that are FK-validated when an upload lands. Membership means
 * "POST /api/pm/files looks up `locationId` in the matching Mongo collection
 * and rejects when it doesn't exist". Anything not in this set is allowed
 * through (placeholder-writes pattern from Phase 0).
 */
export const FK_VALIDATED_LOCATION_TYPES = new Set<string>([
  // Phase 1
  'Property',
  'Unit',
  'Tenant',
  'RentalOwner',
  // Phase 2
  'BankAccount',
  'ChartOfAccount',
  'JournalEntry',
  'Deposit',
  'LockedPeriodPolicy',
  'CompanyAccount',
  // Phase 3 — leasing-lifecycle entities
  'Listing',
  'Prospect',
  'Applicant',
  'DraftLease',
  'Lease',
  'RentersInsurancePolicy',
  'Pet',
  // Phase 4 — Maintenance + A/P entities
  'Vendor',
  'Task',
  'WorkOrder',
  'Bill',
  'BillPayment',
  'RecurringTransaction',
  'EftRequest',
  'CalendarEvent',
]);

/**
 * Collection name lookup used by the polymorphic file route to perform the
 * existence check. Keep this in sync with FK_VALIDATED_LOCATION_TYPES.
 */
export const COLLECTION_BY_LOCATION_TYPE: Record<string, string> = {
  Property: 'pm_properties',
  Unit: 'pm_units',
  Tenant: 'pm_tenants',
  RentalOwner: 'pm_rental_owners',
  BankAccount: 'pm_bank_accounts',
  ChartOfAccount: 'pm_chart_of_accounts',
  JournalEntry: 'pm_journal_entries',
  Deposit: 'pm_deposits',
  LockedPeriodPolicy: 'pm_locked_period_policies',
  CompanyAccount: 'pm_company_accounts',
  Listing: 'pm_listings',
  Prospect: 'pm_prospects',
  Applicant: 'pm_applicants',
  DraftLease: 'pm_draft_leases',
  Lease: 'pm_leases',
  RentersInsurancePolicy: 'pm_renters_insurance_policies',
  Pet: 'pm_pets',
  // Phase 4 — Maintenance + A/P entities
  Vendor: 'pm_vendors',
  Task: 'pm_tasks',
  WorkOrder: 'pm_work_orders',
  Bill: 'pm_bills',
  BillPayment: 'pm_bill_payments',
  RecurringTransaction: 'pm_recurring_transactions',
  EftRequest: 'pm_eft_requests',
  CalendarEvent: 'pm_calendar_events',
};

/** Type guard for runtime checks. */
export function isParentType(v: unknown): v is (typeof PARENT_TYPES)[number] {
  return typeof v === "string" && (PARENT_TYPES as readonly string[]).includes(v);
}

export function isFileLocationType(
  v: unknown,
): v is (typeof FILE_LOCATION_TYPES)[number] {
  return (
    typeof v === "string" && (FILE_LOCATION_TYPES as readonly string[]).includes(v)
  );
}
