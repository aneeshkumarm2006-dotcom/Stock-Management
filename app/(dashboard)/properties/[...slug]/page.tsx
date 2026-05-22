// Catch-all for every Property Management sub-route while the module is being
// built. Each real screen will replace this by adding its own page.tsx at the
// matching path (e.g. app/(dashboard)/properties/rentals/properties/page.tsx).
import { ComingSoon } from "@/components/pm/ComingSoon";

// Per-route title derived from the slug so the browser tab reflects which PM
// page the user is on — useful since they all render the same placeholder.
export function generateMetadata({
  params,
}: {
  params: { slug: string[] };
}) {
  const last = params.slug?.[params.slug.length - 1] ?? "";
  const pretty = last
    .split("-")
    .map((p) => (p ? p.charAt(0).toUpperCase() + p.slice(1) : ""))
    .join(" ");
  return { title: pretty ? `${pretty} — Property Management` : "Property Management" };
}

const TITLES: Record<string, string> = {
  "rentals/properties": "Properties",
  "rentals/rent-roll": "Rent roll",
  "rentals/tenants": "Tenants",
  "rentals/rental-owners": "Rental owners",
  "rentals/outstanding-balances": "Outstanding balances",
  "leasing/listings": "Listings",
  "leasing/prospects": "Prospects",
  "leasing/applicants": "Applicants",
  "leasing/draft-leases": "Draft leases",
  "leasing/lease-renewals": "Lease renewals",
  "leasing/lease-management": "Lease management",
  "accounting/financials": "Financials",
  "accounting/general-ledger": "General ledger",
  "accounting/banking": "Banking",
  "accounting/bills": "Bills",
  "accounting/recurring-transactions": "Recurring transactions",
  "accounting/eft-approvals": "EFT approvals",
  "accounting/budgets": "Budgets",
  "accounting/chart-of-accounts": "Chart of accounts",
  "accounting/locked-periods": "Locked periods",
  "accounting/company-financials": "Company financials",
  "accounting/1099-tax-filings": "1099 tax filings",
  "maintenance/vendors": "Vendors",
  "maintenance/work-orders": "Work orders",
  "maintenance/property-inspections": "Property inspections",
  "communication/emails": "Emails",
  "communication/text-messages": "Text messages",
  "communication/mailings": "Mailings",
  "communication/announcements": "Announcements",
  "communication/templates": "Mailing and email templates",
  "communication/automated-email-settings": "Automated email settings",
  "communication/resident-center-settings": "Resident Center settings",
  "communication/public-site": "Public site",
  calendars: "Calendars",
  files: "Files",
  reports: "Reports",
  analytics: "Analytics Hub",
};

export default function PropertyManagementPlaceholder({
  params,
}: {
  params: { slug: string[] };
}) {
  const key = (params.slug ?? []).join("/");
  const title = TITLES[key] ?? "Property Management";
  return <ComingSoon title={title} />;
}
