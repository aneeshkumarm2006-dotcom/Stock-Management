// Resolves `PmFile.locationType + locationId` into a human-readable string for
// the central Files list (PDR §3.29 §9 — Location column back-pointer).
//
// Batch design: callers pass `[{locationType, locationId}, ...]` and we group
// by collection, run one $in query per collection, and return a flat
// `id → displayString` map keyed by the locationId string. `Account` rows
// have no locationId and are not included in the map.
//
// Falls back to `"{locationType} #{id-prefix}"` when an FK is dangling
// (BR-FI keeps the row even if the parent was archived).
import mongoose, { Types } from 'mongoose';
import { COLLECTION_BY_LOCATION_TYPE } from '@/lib/pm/parentTypes';

export interface LocationKey {
  locationType: string;
  locationId: string | null;
}

export interface LocationDisplay {
  /** Primary label (e.g. property name, tenant name, "Bill #123"). */
  label: string;
  /** Secondary line — typically the locationType (e.g. "Vendor", "Lease"). */
  subLabel: string;
  /** Best-effort deep link target; null for entities whose detail page is not built yet. */
  href: string | null;
}

interface IdRow {
  _id: Types.ObjectId;
  [k: string]: unknown;
}

/** What we select from each collection. */
const PROJECTION_BY_COLLECTION: Record<string, Record<string, 1>> = {
  pm_properties: { propertyName: 1 },
  pm_units: { unitId: 1, propertyId: 1 },
  pm_tenants: { firstName: 1, lastName: 1 },
  pm_rental_owners: { firstName: 1, lastName: 1, isCompany: 1, companyName: 1 },
  pm_vendors: { firstName: 1, lastName: 1, isCompany: 1, companyName: 1 },
  pm_bank_accounts: { name: 1 },
  pm_chart_of_accounts: { accountName: 1, accountNumber: 1 },
  pm_journal_entries: { entryNumber: 1, memo: 1 },
  pm_deposits: { depositNumber: 1, memo: 1 },
  pm_locked_period_policies: { name: 1, lockDate: 1 },
  pm_company_accounts: { name: 1 },
  pm_listings: { headline: 1 },
  pm_prospects: { firstName: 1, lastName: 1 },
  pm_applicants: { firstName: 1, lastName: 1 },
  pm_draft_leases: { tenantNames: 1 },
  pm_leases: { tenantNames: 1, unitId: 1 },
  pm_renters_insurance_policies: { policyNumber: 1, providerName: 1 },
  pm_pets: { name: 1, species: 1 },
  pm_tasks: { title: 1, taskId: 1 },
  pm_work_orders: { workOrderNumber: 1, subject: 1 },
  pm_bills: { billNumber: 1, vendorId: 1 },
  pm_bill_payments: { paymentNumber: 1, memo: 1 },
  pm_recurring_transactions: { memo: 1 },
  pm_eft_requests: { batchNumber: 1, memo: 1 },
  pm_calendar_events: { title: 1, startsAt: 1 },
  pm_projects: { name: 1, projectId: 1 },
  pm_recurring_tasks: { title: 1 },
  pm_owner_contribution_requests: { amount: 1, propertyId: 1 },
  pm_email_messages: { subject: 1, sentAt: 1 },
  pm_email_templates: { name: 1 },
  pm_email_threads: { subject: 1 },
};

/** Best-effort hrefs back to the originating entity's detail page (when built). */
const HREF_BY_LOCATION_TYPE: Record<
  string,
  (id: string, row: IdRow) => string | null
> = {
  Property: (id) => `/properties/rentals/properties/${id}`,
  Unit: (id, row) =>
    row.propertyId
      ? `/properties/rentals/properties/${String(row.propertyId)}/units/${id}`
      : null,
  Lease: (id) => `/properties/rentals/rent-roll/${id}`,
  DraftLease: (id) => `/properties/leasing/draft-leases/${id}`,
  Listing: (id) => `/properties/leasing/listings/${id}`,
  Prospect: (id) => `/properties/leasing/prospects/${id}`,
  Applicant: (id) => `/properties/leasing/applicants/${id}`,
  Tenant: (id) => `/properties/rentals/tenants/${id}`,
  RentalOwner: (id) => `/properties/rentals/rental-owners/${id}`,
  Vendor: (id) => `/properties/maintenance/vendors/${id}`,
  WorkOrder: (id) => `/properties/maintenance/work-orders/${id}`,
  Task: (id) => `/properties/tasks/${id}`,
  Project: (id) => `/properties/projects/${id}`,
  EmailMessage: () => null,
  CalendarEvent: (id) => `/properties/calendars?event=${id}`,
  Bill: (id) => `/properties/accounting/bills?focus=${id}`,
  BillPayment: () => null,
  JournalEntry: (id) => `/properties/accounting/general-ledger?je=${id}`,
  Deposit: () => `/properties/accounting/banking`,
  BankAccount: (id) => `/properties/accounting/banking/${id}`,
  ChartOfAccount: () => `/properties/accounting/chart-of-accounts`,
  LockedPeriodPolicy: () => `/properties/accounting/locked-periods`,
  CompanyAccount: () => `/properties/accounting/company-financials`,
  EftRequest: () => `/properties/accounting/eft-approvals`,
  RecurringTransaction: () => `/properties/accounting/recurring-transactions`,
  RentersInsurancePolicy: () => null,
  Pet: () => null,
  RecurringTask: () => `/properties/tasks/recurring`,
  EmailTemplate: () => `/properties/communication/templates`,
  EmailThread: () => null,
  OwnerContributionRequest: () => null,
};

function formatPerson(d: IdRow): string {
  const isCompany = d.isCompany;
  const companyName = d.companyName;
  if (isCompany && typeof companyName === 'string' && companyName.trim()) {
    return companyName;
  }
  const first = typeof d.firstName === 'string' ? d.firstName : '';
  const last = typeof d.lastName === 'string' ? d.lastName : '';
  const joined = `${first} ${last}`.trim();
  return joined || '(unnamed)';
}

function formatRowForCollection(
  collection: string,
  row: IdRow,
): string {
  switch (collection) {
    case 'pm_properties':
      return String(row.propertyName ?? 'Property');
    case 'pm_units':
      return `Unit ${String(row.unitId ?? '')}`.trim();
    case 'pm_tenants':
    case 'pm_prospects':
    case 'pm_applicants':
      return formatPerson(row);
    case 'pm_rental_owners':
    case 'pm_vendors':
      return formatPerson(row);
    case 'pm_bank_accounts':
    case 'pm_company_accounts':
    case 'pm_locked_period_policies':
    case 'pm_email_templates':
      return String(row.name ?? '(unnamed)');
    case 'pm_chart_of_accounts': {
      const num = row.accountNumber ? `${String(row.accountNumber)} ` : '';
      return `${num}${String(row.accountName ?? '')}`.trim() || 'Account';
    }
    case 'pm_journal_entries':
      return `JE #${String(row.entryNumber ?? '')}`.trim();
    case 'pm_deposits':
      return `Deposit #${String(row.depositNumber ?? '')}`.trim();
    case 'pm_listings':
      return String(row.headline ?? 'Listing');
    case 'pm_draft_leases': {
      const names = Array.isArray(row.tenantNames) ? row.tenantNames.join(', ') : '';
      return names || 'Draft lease';
    }
    case 'pm_leases': {
      const names = Array.isArray(row.tenantNames) ? row.tenantNames.join(', ') : '';
      return names || 'Lease';
    }
    case 'pm_renters_insurance_policies': {
      const provider = row.providerName ? String(row.providerName) : '';
      const policyNumber = row.policyNumber ? String(row.policyNumber) : '';
      return [provider, policyNumber].filter(Boolean).join(' ') || 'Policy';
    }
    case 'pm_pets':
      return [row.name, row.species].filter(Boolean).join(' • ') || 'Pet';
    case 'pm_tasks':
      return `#${String(row.taskId ?? '')} ${String(row.title ?? '')}`.trim();
    case 'pm_work_orders': {
      const num = row.workOrderNumber ? `WO #${String(row.workOrderNumber)}` : 'Work order';
      const subj = row.subject ? ` — ${String(row.subject)}` : '';
      return `${num}${subj}`;
    }
    case 'pm_bills':
      return `Bill #${String(row.billNumber ?? '')}`.trim();
    case 'pm_bill_payments':
      return `Payment #${String(row.paymentNumber ?? '')}`.trim();
    case 'pm_recurring_transactions':
      return String(row.memo ?? 'Recurring');
    case 'pm_eft_requests':
      return `EFT batch #${String(row.batchNumber ?? '')}`.trim();
    case 'pm_calendar_events':
      return String(row.title ?? 'Event');
    case 'pm_projects':
      return `#${String(row.projectId ?? '')} ${String(row.name ?? '')}`.trim();
    case 'pm_recurring_tasks':
      return String(row.title ?? 'Recurring task');
    case 'pm_owner_contribution_requests':
      return `Owner contribution${row.amount ? ` $${String(row.amount)}` : ''}`;
    case 'pm_email_messages':
      return String(row.subject ?? 'Email');
    case 'pm_email_threads':
      return String(row.subject ?? 'Thread');
    default:
      return collection;
  }
}

const ACCOUNT_DISPLAY: LocationDisplay = {
  label: '(Account file)',
  subLabel: 'Account',
  href: null,
};

/**
 * Resolves a list of locations into display objects keyed by the locationId
 * string. Returns a plain object so it round-trips through JSON safely.
 *
 * NOTE: This is best-effort. If a parent collection doesn't exist yet (Phase
 * 0 placeholder writes) or the parent row was deleted, callers get the
 * fallback `{LocationType} #{prefix}` label so the row still renders.
 */
export async function resolveLocationDisplays(
  locations: LocationKey[],
  orgId: string | Types.ObjectId,
): Promise<Record<string, LocationDisplay>> {
  const out: Record<string, LocationDisplay> = {};
  const orgObjectId =
    typeof orgId === 'string' ? new Types.ObjectId(orgId) : orgId;

  // Group ids by locationType.
  const grouped = new Map<string, Set<string>>();
  for (const { locationType, locationId } of locations) {
    if (locationType === 'Account' || !locationId) continue;
    if (!Types.ObjectId.isValid(locationId)) continue;
    const set = grouped.get(locationType) ?? new Set<string>();
    set.add(locationId);
    grouped.set(locationType, set);
  }

  const conn = mongoose.connection;
  if (!conn?.db) return out;

  await Promise.all(
    Array.from(grouped.entries()).map(async ([locationType, idSet]) => {
      const collection = COLLECTION_BY_LOCATION_TYPE[locationType];
      if (!collection) return;
      const projection = PROJECTION_BY_COLLECTION[collection];
      if (!projection) return;
      const objectIds = Array.from(idSet).map((id) => new Types.ObjectId(id));
      const rows = await conn.db!
        .collection<IdRow>(collection)
        .find(
          { _id: { $in: objectIds }, organizationId: orgObjectId },
          { projection },
        )
        .toArray();

      const hrefFor = HREF_BY_LOCATION_TYPE[locationType];
      for (const row of rows) {
        const id = String(row._id);
        out[id] = {
          label: formatRowForCollection(collection, row),
          subLabel: locationType,
          href: hrefFor ? hrefFor(id, row) : null,
        };
      }

      // Fallback for any id that didn't resolve (parent deleted/missing).
      Array.from(idSet).forEach((id) => {
        if (!out[id]) {
          out[id] = {
            label: `${locationType} ${id.slice(-6)}`,
            subLabel: locationType,
            // No row data for dangling FKs, so href builders that need extra
            // fields (e.g. Unit → propertyId) fall back to null.
            href: hrefFor ? hrefFor(id, {} as IdRow) : null,
          };
        }
      });
    }),
  );

  return out;
}

export { ACCOUNT_DISPLAY };
