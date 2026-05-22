// Shared TypeScript types for the Property Management module (Phase 0).
// Mongoose schemas and Zod validators consume these unions so the polymorphic
// parent system stays type-safe end-to-end. Refs: PROPERTY_TODO.md Phase 0;
// PDR_MASTER §3.29 (File), §3.33 (Note), §3.38 (ActivityLogEntry).

import type { PARENT_TYPES, FILE_LOCATION_TYPES } from "@/lib/pm/parentTypes";

/** Polymorphic parent for Note + ActivityLogEntry (Phase 0 set). */
export type ParentType = (typeof PARENT_TYPES)[number];

/** Polymorphic location for File — adds `Account` to ParentType. */
export type FileLocationType = (typeof FILE_LOCATION_TYPES)[number];

/**
 * Organization-membership roles (BR-AC-3, BR-CX, Phase 0a [G-B-22]).
 * `Admin` is a super-role and implies all others.
 */
export type OrgRole =
  | "Admin"
  | "PropertyManager"
  | "Accountant"
  | "FinancialAdministrator";

/** Provisional Note.noteType enum — DECISIONS.md [G-S-19]. */
export type NoteType =
  | "RENTAL"
  | "MAINTENANCE"
  | "LEASING"
  | "ACCOUNTING"
  | "GENERAL";

/** Bell-badge notification kinds (Phase 0 — UI only). */
export type NotificationKind = "info" | "warning" | "alert";

/** Sharing axis for files (Phase 0 — visibility flag, not access control). */
export type FileSharing = "Internal" | "Resident" | "Owner" | "PublicLink";

/** Custom field input shapes (Phase 0a-ratifiable). */
export type CustomFieldType =
  | "text"
  | "number"
  | "date"
  | "boolean"
  | "enum";

/** Org-level accounting basis (BR-AC-2 toggle). */
export type AccountingMode = "cash" | "accrual";

/** Subscription state for the trial-countdown chip (BR-CX-1). */
export type SubscriptionStatus = "trial" | "active" | "expired";

// -----------------------------------------------------------------------------
// Phase 1 — Rentals foundation enums (DECISIONS.md Phase 1)
// -----------------------------------------------------------------------------

/** Property class (PDR §3.1). */
export type PropertyClass = "Residential" | "Commercial";

/** PropertySubType — gated by PropertyClass. DECISIONS.md [G-S-24]. */
export type ResidentialSubType = "Single-Family" | "Multi-Family" | "Condo-Townhome";
export type CommercialSubType = "Industrial" | "Office" | "Retail";
export type PropertySubType = ResidentialSubType | CommercialSubType;

export const RESIDENTIAL_SUBTYPES: readonly ResidentialSubType[] = [
  "Single-Family",
  "Multi-Family",
  "Condo-Townhome",
] as const;

export const COMMERCIAL_SUBTYPES: readonly CommercialSubType[] = [
  "Industrial",
  "Office",
  "Retail",
] as const;

/** BankAccount.type — DECISIONS.md [G-S-15]. */
export type BankAccountType = "Checking" | "Savings" | "Cash";

/** ChartOfAccount.type — DECISIONS.md [G-S-12]. */
export type ChartOfAccountType =
  | "Current Asset"
  | "Current Asset (cash)"
  | "Fixed Asset"
  | "Current Liability"
  | "Long-term Liability"
  | "Equity"
  | "Income"
  | "Operating Expense";

/** ChartOfAccount.cashFlowClassification — DECISIONS.md [G-S-13]. */
export type CashFlowClassification =
  | "Operating activities"
  | "Investing activities"
  | "Financing activities"
  | "N/A";

/** ChartOfAccount.defaultFor — DECISIONS.md [G-S-14]. */
export type ChartOfAccountDefaultFor =
  | "Accounts Payable"
  | "Accounts Receivable"
  | "Application Fee Income"
  | "Bank Fees"
  | "Convenience Fee"
  | "Last Month's Rent"
  | "Late Fee Income"
  | "Management Fee Income"
  | "Operating Cash"
  | "Security Deposit Liability"
  | "Undeposited Funds";

/** Vendor.taxIdentityType — DECISIONS.md [G-S-25]. Pre-declared for Phase 4. */
export type TaxIdentityType = "SSN" | "EIN" | "ITIN";

// -----------------------------------------------------------------------------
// Phase 2 — Accounting ledger enums
// -----------------------------------------------------------------------------

/** JournalEntry.status — DECISIONS.md [G-S-18]. Posted is the steady state;
 * Draft is editable; Voided is paired with a reversing JE via
 * `reversesJournalEntryId`. Reports filter `status !== 'Voided'`. */
export type JournalEntryStatus = "Posted" | "Draft" | "Voided";

/** JournalEntry / JournalLine scope (PDR §3.19, §3.19a). A JE's scope is
 * advisory — BR-AC-14 lets individual lines target different scopes within a
 * single entry (multi-property posting). */
export type JournalEntryScopeType = "Property" | "Company";

/** LockedPeriodPolicy.scope (PDR §3.27). Per-property requires `propertyId`. */
export type LockedPeriodScope = "Global" | "Per-property";

/** Deposit.status — Posted is the steady state; Voided is paired with the
 * underlying JE being voided. */
export type DepositStatus = "Posted" | "Voided";

// -----------------------------------------------------------------------------
// Phase 3 — Leasing lifecycle enums
// -----------------------------------------------------------------------------

/** Prospect.status — DECISIONS.md [G-S-2]. 6 buckets covering the CRM
 *  funnel from first touch through funnel exit. Set per Phase 3 since the
 *  decision was unblocked inline. */
export type ProspectStatus =
  | "New"
  | "Contacted"
  | "Toured"
  | "Application sent"
  | "Lost"
  | "Converted";

export const PROSPECT_STATUSES: readonly ProspectStatus[] = [
  "New",
  "Contacted",
  "Toured",
  "Application sent",
  "Lost",
  "Converted",
] as const;

/** Applicant.status — BR-LA-6 explicitly decouples from checklist progress.
 *  PM may approve with open items. */
export type ApplicantStatus =
  | "New"
  | "Screening"
  | "Approved"
  | "Rejected"
  | "Withdrawn"
  | "Converted";

export const APPLICANT_STATUSES: readonly ApplicantStatus[] = [
  "New",
  "Screening",
  "Approved",
  "Rejected",
  "Withdrawn",
  "Converted",
] as const;

/** Applicant.screeningStatus — order-and-watch tri-state. */
export type ApplicantScreeningStatus =
  | "Not ordered"
  | "Ordered"
  | "Received"
  | "Failed";

export const APPLICANT_SCREENING_STATUSES: readonly ApplicantScreeningStatus[] = [
  "Not ordered",
  "Ordered",
  "Received",
  "Failed",
] as const;

/** Lease.esignatureStatus — DECISIONS.md [G-S-1]. 11-value lifecycle that
 *  mirrors Buildium's HelloSign-style envelope tracker. Recorded here so we
 *  unblock the schema and let Phase 3 ship; downstream Phase 6 may add
 *  bounce/error categories. */
export type EsignatureStatus =
  | "Unknown"
  | "Not sent"
  | "Processing"
  | "Sent"
  | "Viewed"
  | "Partially signed"
  | "Signed"
  | "Completed"
  | "Declined"
  | "Voided"
  | "Expired";

export const ESIGNATURE_STATUSES: readonly EsignatureStatus[] = [
  "Unknown",
  "Not sent",
  "Processing",
  "Sent",
  "Viewed",
  "Partially signed",
  "Signed",
  "Completed",
  "Declined",
  "Voided",
  "Expired",
] as const;

/** Lease.leaseType — BR-LL-1: At-will leases do NOT require endDate. */
export type LeaseType = "Fixed" | "Fixed w/rollover" | "At-will";

export const LEASE_TYPES: readonly LeaseType[] = [
  "Fixed",
  "Fixed w/rollover",
  "At-will",
] as const;

/** Lease.status — derived primarily by date math but persisted for fast
 *  filtering on `(2) Active, Future` (BR-LL-2). */
export type LeaseStatus =
  | "Active"
  | "Future"
  | "Expired"
  | "Ended"
  | "Cancelled";

export const LEASE_STATUSES: readonly LeaseStatus[] = [
  "Active",
  "Future",
  "Expired",
  "Ended",
  "Cancelled",
] as const;

/** DraftLease.executionStatus — order-of-operations gate before promote. */
export type DraftLeaseExecutionStatus =
  | "Draft"
  | "Out for signature"
  | "Ready to execute"
  | "Executed"
  | "Cancelled";

export const DRAFT_LEASE_EXECUTION_STATUSES: readonly DraftLeaseExecutionStatus[] = [
  "Draft",
  "Out for signature",
  "Ready to execute",
  "Executed",
  "Cancelled",
] as const;

/** RentCycle — drives recurring rent charge cadence. */
export type RentCycle = "Monthly" | "Weekly" | "Bi-weekly" | "Quarterly" | "Yearly";

export const RENT_CYCLES: readonly RentCycle[] = [
  "Monthly",
  "Weekly",
  "Bi-weekly",
  "Quarterly",
  "Yearly",
] as const;

/** RentersInsurancePolicy.carrier — third-party vs Buildium-bundled MSI. */
export type RentersInsuranceCarrier = "MSI" | "Third Party";

export const RENTERS_INSURANCE_CARRIERS: readonly RentersInsuranceCarrier[] = [
  "MSI",
  "Third Party",
] as const;

/** Pet.petType — minimal classification; freeform `breed` not modelled. */
export type PetType =
  | "Dog"
  | "Cat"
  | "Bird"
  | "Reptile"
  | "Small mammal"
  | "Fish"
  | "Other";

export const PET_TYPES: readonly PetType[] = [
  "Dog",
  "Cat",
  "Bird",
  "Reptile",
  "Small mammal",
  "Fish",
  "Other",
] as const;

/** Renewal sub-tab — `Not started | Renewal offers | Accepted offers`
 *  per BR-LL-12. The persisted `renewalState` lives on the renewal
 *  projection, not the Lease itself. */
export type RenewalState = "Not started" | "Offer sent" | "Accepted" | "Declined";

export const RENEWAL_STATES: readonly RenewalState[] = [
  "Not started",
  "Offer sent",
  "Accepted",
  "Declined",
] as const;

/** US ISO-3166 sub-division states/territories used by composite address. */
export type UsState =
  | "AL" | "AK" | "AZ" | "AR" | "CA" | "CO" | "CT" | "DE" | "FL" | "GA"
  | "HI" | "ID" | "IL" | "IN" | "IA" | "KS" | "KY" | "LA" | "ME" | "MD"
  | "MA" | "MI" | "MN" | "MS" | "MO" | "MT" | "NE" | "NV" | "NH" | "NJ"
  | "NM" | "NY" | "NC" | "ND" | "OH" | "OK" | "OR" | "PA" | "RI" | "SC"
  | "SD" | "TN" | "TX" | "UT" | "VT" | "VA" | "WA" | "WV" | "WI" | "WY"
  | "DC" | "PR";
