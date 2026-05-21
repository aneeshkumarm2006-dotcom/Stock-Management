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

/** US ISO-3166 sub-division states/territories used by composite address. */
export type UsState =
  | "AL" | "AK" | "AZ" | "AR" | "CA" | "CO" | "CT" | "DE" | "FL" | "GA"
  | "HI" | "ID" | "IL" | "IN" | "IA" | "KS" | "KY" | "LA" | "ME" | "MD"
  | "MA" | "MI" | "MN" | "MS" | "MO" | "MT" | "NE" | "NV" | "NH" | "NJ"
  | "NM" | "NY" | "NC" | "ND" | "OH" | "OK" | "OR" | "PA" | "RI" | "SC"
  | "SD" | "TN" | "TX" | "UT" | "VT" | "VA" | "WA" | "WV" | "WI" | "WY"
  | "DC" | "PR";
