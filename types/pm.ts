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

/** ChartOfAccount.defaultFor — DECISIONS.md [G-S-14]. Phase 9 added the
 *  Bank Service Charges, Interest Income, Management Fee Expense, and
 *  Owner Contribution slots required by reconciliation adjustments
 *  (BR-AC-17), management-fee posting (BR-AC-16), and owner-contribution
 *  income (BR-AC-19 cross-link to OwnerContributionRequest §3.25). */
export type ChartOfAccountDefaultFor =
  | "Accounts Payable"
  | "Accounts Receivable"
  | "Application Fee Income"
  | "Bank Fees"
  | "Bank Service Charges"
  | "Convenience Fee"
  | "Interest Income"
  | "Last Month's Rent"
  | "Late Fee Income"
  | "Management Fee Expense"
  | "Management Fee Income"
  | "Operating Cash"
  | "Owner Contribution"
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

// -----------------------------------------------------------------------------
// Phase 4 — Maintenance + A/P enums (DECISIONS.md Phase 4)
// -----------------------------------------------------------------------------

/** WorkOrder.status — DECISIONS.md [G-S-4]. `Completed` + `Cancelled` are
 *  terminal; UI grays out further status edits but bill posting remains
 *  permitted against a `Completed` WO. */
export type WorkOrderStatus =
  | "New"
  | "In progress"
  | "On hold"
  | "Completed"
  | "Cancelled";

export const WORK_ORDER_STATUSES: readonly WorkOrderStatus[] = [
  "New",
  "In progress",
  "On hold",
  "Completed",
  "Cancelled",
] as const;

export const WORK_ORDER_TERMINAL_STATUSES: readonly WorkOrderStatus[] = [
  "Completed",
  "Cancelled",
] as const;

/** Shared priority chip used by WorkOrder + Task — DECISIONS.md [G-S-5] +
 *  [G-S-8]. Renders via `<PriorityChip />`. */
export type WorkPriority = "Low" | "Normal" | "High" | "Urgent";

export const WORK_PRIORITIES: readonly WorkPriority[] = [
  "Low",
  "Normal",
  "High",
  "Urgent",
] as const;

/** WorkOrder.entryDetails — DECISIONS.md [G-S-6]. `Do not enter` disables
 *  the entryContacts selector. */
export type EntryDetails =
  | "Tenant will be home"
  | "Permission to enter"
  | "Call first"
  | "Do not enter";

export const ENTRY_DETAILS: readonly EntryDetails[] = [
  "Tenant will be home",
  "Permission to enter",
  "Call first",
  "Do not enter",
] as const;

/** WorkOrder.billStatus — independent of Bill.status lifecycle (BR-MV-9).
 *  Rolled up from the count + amount of Bills linked back via
 *  `Bill.workOrderId`. */
export type WorkOrderBillStatus =
  | "No bills added"
  | "Open"
  | "Partially paid"
  | "Paid"
  | "Voided";

export const WORK_ORDER_BILL_STATUSES: readonly WorkOrderBillStatus[] = [
  "No bills added",
  "Open",
  "Partially paid",
  "Paid",
  "Voided",
] as const;

/** Task.status — DECISIONS.md [G-S-7]. `Closed` is soft archive;
 *  `Cancelled` is explicit walk-away. */
export type TaskStatus =
  | "New"
  | "In progress"
  | "Completed"
  | "Closed"
  | "Cancelled"
  | "On hold";

export const TASK_STATUSES: readonly TaskStatus[] = [
  "New",
  "In progress",
  "Completed",
  "Closed",
  "Cancelled",
  "On hold",
] as const;

export const TASK_TERMINAL_STATUSES: readonly TaskStatus[] = [
  "Completed",
  "Closed",
  "Cancelled",
] as const;

/** Task.taskType — drives the source* fields. */
export type TaskType =
  | "To do"
  | "Resident request"
  | "Rental owner request"
  | "Contact request";

export const TASK_TYPES: readonly TaskType[] = [
  "To do",
  "Resident request",
  "Rental owner request",
  "Contact request",
] as const;

/** WorkOrder.chargeWorkTo — polymorphic, BR-MV-10. UI enforces single pick
 *  via radio group ([G-B-30]). */
export type ChargeTargetType = "Property" | "Lease" | "RentalOwner";

export interface ChargeTarget {
  type: ChargeTargetType;
  id: string;
}

export const CHARGE_TARGET_TYPES: readonly ChargeTargetType[] = [
  "Property",
  "Lease",
  "RentalOwner",
] as const;

/** Bill.status — DECISIONS.md [G-S-17]. `Overdue` is derived nightly. */
export type BillStatus =
  | "Draft"
  | "Due"
  | "Overdue"
  | "Partially paid"
  | "Paid"
  | "Voided";

export const BILL_STATUSES: readonly BillStatus[] = [
  "Draft",
  "Due",
  "Overdue",
  "Partially paid",
  "Paid",
  "Voided",
] as const;

/** Bill.scope.type — Property scope routes the JE into per-property reports;
 *  Company scope is the org-wide G&A bucket. */
export type BillScopeType = "Property" | "Company";

export interface BillScope {
  type: BillScopeType;
  id: string | null;
}

/** BillPayment.paymentMethod — DECISIONS.md [G-S-16]. Check is the only
 *  method that requires `checkNumber`. */
export type BillPaymentMethod = "Check" | "ACH" | "EFT" | "Wire";

export const BILL_PAYMENT_METHODS: readonly BillPaymentMethod[] = [
  "Check",
  "ACH",
  "EFT",
  "Wire",
] as const;

/** RecurringTransaction.type — drives payee cardinality (Bill/Check need a
 *  payee; JE has no payee). */
export type RecurringTransactionType = "Check" | "Bill" | "Journal entry";

export const RECURRING_TRANSACTION_TYPES: readonly RecurringTransactionType[] = [
  "Check",
  "Bill",
  "Journal entry",
] as const;

/** RecurringTransaction.frequency — DECISIONS.md note: Phase 4 ships the
 *  four standard cadences. Custom-interval shape ([G-S-9]) lands in Phase 5
 *  with RecurringTask. */
export type RecurringFrequency =
  | "Weekly"
  | "Monthly"
  | "Quarterly"
  | "Yearly";

export const RECURRING_FREQUENCIES: readonly RecurringFrequency[] = [
  "Weekly",
  "Monthly",
  "Quarterly",
  "Yearly",
] as const;

/** RecurringTransaction.duration — termination rule. */
export type RecurringDuration = "Until cancelled" | "End after N";

export const RECURRING_DURATIONS: readonly RecurringDuration[] = [
  "Until cancelled",
  "End after N",
] as const;

/** RecurringTransaction.payee — polymorphic Vendor|RentalOwner, or null
 *  when type='Journal entry'. */
export type RecurringPayeeType = "Vendor" | "RentalOwner";

export interface RecurringPayee {
  type: RecurringPayeeType;
  id: string;
}

export const RECURRING_PAYEE_TYPES: readonly RecurringPayeeType[] = [
  "Vendor",
  "RentalOwner",
] as const;

/** EftRequest.status — three-state with `Pending` as the inbox bucket. */
export type EftRequestStatus = "Pending" | "Approved" | "Rejected";

export const EFT_REQUEST_STATUSES: readonly EftRequestStatus[] = [
  "Pending",
  "Approved",
  "Rejected",
] as const;

/** EftRequest.payee — polymorphic Vendor|RentalOwner|Tenant. */
export type EftPayeeType = "Vendor" | "RentalOwner" | "Tenant";

export interface EftPayee {
  type: EftPayeeType;
  id: string;
}

export const EFT_PAYEE_TYPES: readonly EftPayeeType[] = [
  "Vendor",
  "RentalOwner",
  "Tenant",
] as const;

// -----------------------------------------------------------------------------
// Phase 6 — Communications enums (PDR_MASTER §3.35–§3.37; PROPERTY_TODO Phase 6)
// -----------------------------------------------------------------------------

/** EmailMessage.status — resolves [G-S-20]. `Sending` is the in-flight
 *  state between Scheduled → Sent (or Send-now → Sent); useful for retries. */
export type EmailStatus =
  | "Draft"
  | "Scheduled"
  | "Sending"
  | "Sent"
  | "Failed";

export const EMAIL_STATUSES: readonly EmailStatus[] = [
  "Draft",
  "Scheduled",
  "Sending",
  "Sent",
  "Failed",
] as const;

/** EmailMessage `to[]/cc[]/bcc[]` entry kind. Custom = free email address
 *  with no entity FK (cosigner / vendor referral / etc). */
export type EmailRecipientType =
  | "Tenant"
  | "RentalOwner"
  | "Vendor"
  | "Applicant"
  | "Property"
  | "Lease"
  | "Custom";

export const EMAIL_RECIPIENT_TYPES: readonly EmailRecipientType[] = [
  "Tenant",
  "RentalOwner",
  "Vendor",
  "Applicant",
  "Property",
  "Lease",
  "Custom",
] as const;

/** EmailMessage.readReceiptStatus — [G-B-24]. `Not tracked` is the
 *  default when transport never reports open/bounce events. */
export type EmailReadReceiptStatus =
  | "Not tracked"
  | "Unopened"
  | "Opened"
  | "Bounced";

export const EMAIL_READ_RECEIPT_STATUSES: readonly EmailReadReceiptStatus[] = [
  "Not tracked",
  "Unopened",
  "Opened",
  "Bounced",
] as const;

/** EmailMessage.relatedEntityType — polymorphic anchor for the
 *  Communications tab renderer. Resolves [G-S-21]. */
export type EmailRelatedEntityType =
  | "Property"
  | "Lease"
  | "Tenant"
  | "RentalOwner"
  | "Vendor"
  | "Applicant"
  | "WorkOrder"
  | "Bill"
  | "Task";

export const EMAIL_RELATED_ENTITY_TYPES: readonly EmailRelatedEntityType[] = [
  "Property",
  "Lease",
  "Tenant",
  "RentalOwner",
  "Vendor",
  "Applicant",
  "WorkOrder",
  "Bill",
  "Task",
] as const;

/** EmailTemplate.type — [G-S-23]. `General` covers "no audience preset". */
export type EmailTemplateType =
  | "Tenant"
  | "RentalOwner"
  | "Vendor"
  | "Applicant"
  | "General";

export const EMAIL_TEMPLATE_TYPES: readonly EmailTemplateType[] = [
  "Tenant",
  "RentalOwner",
  "Vendor",
  "Applicant",
  "General",
] as const;

// -----------------------------------------------------------------------------
// Phase 7 — CalendarEvent enums (PDR_MASTER §3.34, [G-S-10], [G-S-11], [G-S-28])
// -----------------------------------------------------------------------------

/** CalendarEvent.repeat cadence — [G-S-10]. */
export type CalendarRepeat =
  | "Does not repeat"
  | "Daily"
  | "Weekly"
  | "Monthly"
  | "Annually"
  | "Custom";

export const CALENDAR_REPEATS: readonly CalendarRepeat[] = [
  "Does not repeat",
  "Daily",
  "Weekly",
  "Monthly",
  "Annually",
  "Custom",
] as const;

/** CalendarEvent.reminder lead-time choice — [G-S-11]. */
export type CalendarReminder =
  | "None"
  | "5 minutes before"
  | "15 minutes before"
  | "30 minutes before"
  | "1 hour before"
  | "1 day before"
  | "1 week before";

export const CALENDAR_REMINDERS: readonly CalendarReminder[] = [
  "None",
  "5 minutes before",
  "15 minutes before",
  "30 minutes before",
  "1 hour before",
  "1 day before",
  "1 week before",
] as const;

/** Calendar grid view mode — Day / Week / Month. */
export type CalendarView = "day" | "week" | "month";

/** Recurring-event edit/delete semantics — DECISIONS [G-B-13]. */
export type CalendarEditScope = "instance" | "series";

export const CALENDAR_EDIT_SCOPES: readonly CalendarEditScope[] = [
  "instance",
  "series",
] as const;

/** BR-CC-7 — multi-property overlay cap on the grid. */
export const CALENDAR_MAX_OVERLAYS = 15 as const;

/** Reminder lead-time map for the dispatcher sweep. -1 = never fires. */
export const CALENDAR_REMINDER_LEAD_MS: Record<CalendarReminder, number> = {
  "None": -1,
  "5 minutes before": 5 * 60_000,
  "15 minutes before": 15 * 60_000,
  "30 minutes before": 30 * 60_000,
  "1 hour before": 60 * 60_000,
  "1 day before": 24 * 60 * 60_000,
  "1 week before": 7 * 24 * 60 * 60_000,
};

// -----------------------------------------------------------------------------
// Phase 9 — Accounting reports + ancillary
// -----------------------------------------------------------------------------

/** Budget.scopeType — Property-level or Company-level budget. Resolves
 *  PDR §3.26 `propertyOrCompanyId` polymorphism. One per Property per FY
 *  (BR-AC-11); Company-scope budgets have no uniqueness constraint. */
export type BudgetScopeType = "Property" | "Company";

export const BUDGET_SCOPE_TYPES: readonly BudgetScopeType[] = [
  "Property",
  "Company",
] as const;

/** Budget.defaultAmounts — initial seed for monthly cells (PDR §3.26).
 *  `Zero` ships an empty grid; `Copy previous FY actuals` snapshots last
 *  year's posted GL into this year's budget (BR-AC-11); `Copy existing
 *  budget` requires `copySourceBudgetId`. */
export type BudgetDefaultAmounts =
  | "Zero"
  | "Copy previous FY actuals"
  | "Copy existing budget";

export const BUDGET_DEFAULT_AMOUNTS: readonly BudgetDefaultAmounts[] = [
  "Zero",
  "Copy previous FY actuals",
  "Copy existing budget",
] as const;

/** BudgetLine.category — drives the sub-tab split on /budgets. */
export type BudgetLineCategory = "Income" | "Expense";

export const BUDGET_LINE_CATEGORIES: readonly BudgetLineCategory[] = [
  "Income",
  "Expense",
] as const;

/** Calendar months used by fiscalYearStart picker. `January` is the default
 *  per PDR §3.26; custom fiscal years are [G-S-35]. */
export type FiscalMonth =
  | "January"
  | "February"
  | "March"
  | "April"
  | "May"
  | "June"
  | "July"
  | "August"
  | "September"
  | "October"
  | "November"
  | "December";

export const FISCAL_MONTHS: readonly FiscalMonth[] = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/** Map each fiscal month label to its 1-based month index for `Date` math. */
export const FISCAL_MONTH_INDEX: Record<FiscalMonth, number> = {
  January: 1,
  February: 2,
  March: 3,
  April: 4,
  May: 5,
  June: 6,
  July: 7,
  August: 8,
  September: 9,
  October: 10,
  November: 11,
  December: 12,
};

/** Reconciliation.status — Phase 9 wizard lifecycle.
 *  `In progress` is the wizard editing state; `Completed` locks the period
 *  per BR-AC-17; `Voided` is the explicit undo used when a discrepancy is
 *  spotted later. */
export type ReconciliationStatus = "In progress" | "Completed" | "Voided";

export const RECONCILIATION_STATUSES: readonly ReconciliationStatus[] = [
  "In progress",
  "Completed",
  "Voided",
] as const;

/** ApprovalRule.scope — DECISIONS.md [G-S-31] / BR-AC-19. `Company` scope
 *  applies to every EFT in the org; `Property` scope only applies when the
 *  EFT's underlying Bill is tagged to that Property. */
export type ApprovalRuleScopeType = "Company" | "Property";

export const APPROVAL_RULE_SCOPE_TYPES: readonly ApprovalRuleScopeType[] = [
  "Company",
  "Property",
] as const;

/** ApprovalRule.semantics — multi-approver gate (BR-AC-19). `any-of` only
 *  needs one approver in the list; `all-of` requires every approver to
 *  sign before the EFT posts to the GL. */
export type ApprovalRuleSemantics = "any-of" | "all-of";

export const APPROVAL_RULE_SEMANTICS: readonly ApprovalRuleSemantics[] = [
  "any-of",
  "all-of",
] as const;

/** 1099 form types — DECISIONS.md [G-S-30]. NEC covers non-employee
 *  compensation ≥ $600; MISC covers rents + other categories. Both flow
 *  off the Vendor Tax identity + Bill payment ledger. */
export type Tax1099FormType = "1099-NEC" | "1099-MISC";

export const TAX_1099_FORM_TYPES: readonly Tax1099FormType[] = [
  "1099-NEC",
  "1099-MISC",
] as const;

/** 1099 delivery mode — DECISIONS.md [G-S-30]. */
export type Tax1099DeliveryMode = "E-file" | "Mail";

export const TAX_1099_DELIVERY_MODES: readonly Tax1099DeliveryMode[] = [
  "E-file",
  "Mail",
] as const;

/** IRS-mandated annual threshold for 1099-NEC reporting (per DECISIONS.md
 *  [G-S-30]). Centralized so the screen-level filter and the tax-form
 *  emitter use the same constant. */
export const TAX_1099_THRESHOLD_DOLLARS = 600 as const;

/** BankFeedTransaction.source — DECISIONS.md [G-S-33] resolves to CSV/OFX
 *  import only for Phase 9; Plaid/MX integrations deferred. */
export type BankFeedSource = "CSV" | "OFX";

export const BANK_FEED_SOURCES: readonly BankFeedSource[] = [
  "CSV",
  "OFX",
] as const;

/** BankFeedTransaction.status — three-state lifecycle. `Unmatched` is the
 *  inbox bucket after import; `Matched` means it points at an existing
 *  JournalLine (clears the line immediately); `Ignored` is the user's
 *  explicit "this row never posted to our books" choice. */
export type BankFeedMatchStatus = "Unmatched" | "Matched" | "Ignored";

export const BANK_FEED_MATCH_STATUSES: readonly BankFeedMatchStatus[] = [
  "Unmatched",
  "Matched",
  "Ignored",
] as const;

/** ManagementFeeAgreement.billingFrequency — drives the cadence the
 *  `collectManagementFees` helper uses to compute one fee per period.
 *  Embedded on Property per DECISIONS.md [G-S-38]. */
export type ManagementFeeBillingFrequency = "Monthly" | "Quarterly" | "Yearly";

export const MANAGEMENT_FEE_BILLING_FREQUENCIES: readonly ManagementFeeBillingFrequency[] = [
  "Monthly",
  "Quarterly",
  "Yearly",
] as const;

/** EftRequest.approvals[].decision — captured per approver in the chain.
 *  A single `Rejected` ends the chain (BR-AC-10); `Approved` advances. */
export type ApprovalDecision = "Approved" | "Rejected";

export const APPROVAL_DECISIONS: readonly ApprovalDecision[] = [
  "Approved",
  "Rejected",
] as const;
