// Org-default seeding (Phases 0 + 1 + 2). Called by `getOrCreateOrgForUser`.
// Idempotent: each upsert uses `$setOnInsert` so a re-run is a no-op.
//
// Phase 0 seeds: FileCategory `Leases` (BR-FI-2), VendorCategory `Uncategorized`
// (BR-MV-1), TaskCategory `Uncategorized`, ProjectType `Uncategorized`
// (Phase 0a [G-S-41]).
// Phase 1 seeds: system Chart of Accounts (11 rows, all `systemSeeded=true`)
// covering the `defaultFor` enum from DECISIONS.md [G-S-14].
// Phase 2 seeds: one CompanyAccount per org (PDR §3.28 — the management
// company's own books).
import type { Types } from 'mongoose';
import { FileCategory } from '@/lib/db/models/pm/FileCategory';
import { VendorCategory } from '@/lib/db/models/pm/VendorCategory';
import { TaskCategory } from '@/lib/db/models/pm/TaskCategory';
import { ProjectType } from '@/lib/db/models/pm/ProjectType';
import { ChartOfAccount } from '@/lib/db/models/pm/ChartOfAccount';
import { CompanyAccount } from '@/lib/db/models/pm/CompanyAccount';
import { Organization } from '@/lib/db/models/pm/Organization';
import type {
  ChartOfAccountType,
  ChartOfAccountDefaultFor,
  CashFlowClassification,
} from '@/types/pm';

/**
 * Bump whenever SYSTEM_ACCOUNTS / ACCOUNT_GROUPS change so orgs provisioned
 * under an older chart get re-seeded once (Change §0B). The chart-of-accounts
 * route compares this against `Organization.chartSeedVersion` and re-runs the
 * idempotent seed when the org is behind — instead of the old "seeded count
 * is 0" backfill, which never fired for orgs that already had the ~16 rows.
 */
export const CHART_SEED_VERSION = 2;

interface SystemAccountSeed {
  name: string;
  type: ChartOfAccountType;
  defaultFor: ChartOfAccountDefaultFor | null;
  cashFlowClassification: CashFlowClassification;
}

/** A group (header) row plus its postable leaf children (Change §0B). */
interface AccountGroupSeed {
  name: string;
  type: ChartOfAccountType;
  defaultFor: ChartOfAccountDefaultFor | null;
  cashFlowClassification: CashFlowClassification;
  children: SystemAccountSeed[];
}

/** Helper: build leaf seeds sharing a type + cash-flow classification. */
function leaves(
  names: string[],
  type: ChartOfAccountType,
  cashFlowClassification: CashFlowClassification,
): SystemAccountSeed[] {
  return names.map((name) => ({
    name,
    type,
    defaultFor: null,
    cashFlowClassification,
  }));
}

const SYSTEM_ACCOUNTS: SystemAccountSeed[] = [
  // Cash + receivables
  {
    name: 'Operating Cash',
    type: 'Current Asset (cash)',
    defaultFor: 'Operating Cash',
    cashFlowClassification: 'Operating activities',
  },
  {
    name: 'Undeposited Funds',
    type: 'Current Asset (cash)',
    defaultFor: 'Undeposited Funds',
    cashFlowClassification: 'Operating activities',
  },
  {
    name: 'Accounts Receivable',
    type: 'Current Asset',
    defaultFor: 'Accounts Receivable',
    cashFlowClassification: 'Operating activities',
  },
  // Liabilities
  {
    name: 'Accounts Payable',
    type: 'Current Liability',
    defaultFor: 'Accounts Payable',
    cashFlowClassification: 'Operating activities',
  },
  {
    name: 'Security Deposit Liability',
    type: 'Current Liability',
    defaultFor: 'Security Deposit Liability',
    cashFlowClassification: 'Operating activities',
  },
  // Income
  {
    name: 'Rent Income',
    type: 'Income',
    defaultFor: null,
    cashFlowClassification: 'Operating activities',
  },
  {
    name: 'Late Fee Income',
    type: 'Income',
    defaultFor: 'Late Fee Income',
    cashFlowClassification: 'Operating activities',
  },
  {
    name: 'Application Fee Income',
    type: 'Income',
    defaultFor: 'Application Fee Income',
    cashFlowClassification: 'Operating activities',
  },
  {
    name: 'Management Fee Income',
    type: 'Income',
    defaultFor: 'Management Fee Income',
    cashFlowClassification: 'Operating activities',
  },
  {
    name: 'Interest Income',
    type: 'Income',
    defaultFor: 'Interest Income',
    cashFlowClassification: 'Operating activities',
  },
  // Expenses
  {
    name: 'Repairs',
    type: 'Operating Expense',
    defaultFor: null,
    cashFlowClassification: 'Operating activities',
  },
  {
    name: 'Bank Fees',
    type: 'Operating Expense',
    defaultFor: 'Bank Fees',
    cashFlowClassification: 'Operating activities',
  },
  {
    name: 'Bank Service Charges',
    type: 'Operating Expense',
    defaultFor: 'Bank Service Charges',
    cashFlowClassification: 'Operating activities',
  },
  {
    name: 'Management Fee Expense',
    type: 'Operating Expense',
    defaultFor: 'Management Fee Expense',
    cashFlowClassification: 'Operating activities',
  },
  // Equity
  {
    name: 'Owner Contributions',
    type: 'Equity',
    defaultFor: 'Owner Contribution',
    cashFlowClassification: 'Financing activities',
  },
  // ---------------------------------------------------------------------------
  // Ramco chart — top-level (un-grouped) leaves. (changes.md §5 / Change §0B.)
  // ---------------------------------------------------------------------------
  {
    name: 'Miscellaneous income',
    type: 'Income',
    defaultFor: null,
    cashFlowClassification: 'Operating activities',
  },
  {
    // 🔸 Ambiguous in source — seeded as a standalone leaf; confirm with client
    // whether it should become a group.
    name: 'Operating Taxes',
    type: 'Operating Expense',
    defaultFor: null,
    cashFlowClassification: 'Operating activities',
  },
];

/**
 * Ramco's nested chart (changes.md §5 / Change §0B). Each group is a
 * non-postable header (`isGroup: true`); its children are postable leaves.
 * All expense leaves map to the existing `'Operating Expense'` type so they
 * surface in the P&L matrix; the group conveys the operating-vs-non-operating
 * distinction in display.
 */
const ACCOUNT_GROUPS: AccountGroupSeed[] = [
  // --- Income groups ---
  {
    // Roll-up role so Change §6's report can find investment revenue by role,
    // not by a fragile name match.
    name: 'Investment Income',
    type: 'Income',
    defaultFor: 'Investment Income',
    cashFlowClassification: 'Investing activities',
    children: leaves(
      [
        'US Capital Gain / (Loss)',
        'US Interest Income',
        'CDN Interest Income',
        'CDN Dividend Income',
        'CDN Capital Gain / (Loss)',
        'US Foreign Income',
        'US withholding tax',
        'Realized FX – Gain / (Loss)',
      ],
      'Income',
      'Investing activities',
    ),
  },
  {
    name: 'Rental Income (Ordinary Income)',
    type: 'Income',
    defaultFor: null,
    cashFlowClassification: 'Operating activities',
    // The three Change §4 income accounts.
    children: leaves(
      ['Base Rent', 'OPEX Recoveries', 'Tax Recoveries'],
      'Income',
      'Operating activities',
    ),
  },
  // --- Expense groups ---
  {
    name: 'Operating Expenses',
    type: 'Operating Expense',
    defaultFor: null,
    cashFlowClassification: 'Operating activities',
    children: leaves(
      [
        'Municipal Taxes',
        'School Taxes',
        'Water Tax',
        'Property Insurance',
        'Snow Removal',
        'Lawn Care',
        'Waste removal',
        'Repairs & Maintenance',
      ],
      'Operating Expense',
      'Operating activities',
    ),
  },
  {
    name: 'Salaries & Wages',
    type: 'Operating Expense',
    defaultFor: null,
    cashFlowClassification: 'Operating activities',
    children: leaves(
      [
        'Salaries',
        'EI',
        'QPP',
        'FSS',
        'QPIP',
        'CSST',
        'CNT expense',
        'Vacation Accrual',
        'Group Insurance',
        'Payroll Expenses',
      ],
      'Operating Expense',
      'Operating activities',
    ),
  },
  {
    name: 'Administration',
    type: 'Operating Expense',
    defaultFor: null,
    cashFlowClassification: 'Operating activities',
    children: leaves(
      [
        'Rent 4333 Ste-Catherine',
        'Office Insurance',
        'Phone / fax / pagette / cellulaire',
        'Postal / courier expenses',
        'Office expenses',
        'Taxes & licences',
      ],
      'Operating Expense',
      'Operating activities',
    ),
  },
  {
    name: 'Fees',
    type: 'Operating Expense',
    defaultFor: null,
    cashFlowClassification: 'Operating activities',
    children: leaves(
      [
        'Professional Fees – Legal',
        'Professional and Auditing',
        'Management Fees on investment',
      ],
      'Operating Expense',
      'Operating activities',
    ),
  },
  {
    name: 'Non-Operating Administration',
    type: 'Operating Expense',
    defaultFor: null,
    cashFlowClassification: 'Operating activities',
    children: leaves(
      [
        'Car – Gas & parking',
        'Travel Expenses (Taxi)',
        'Meal / restaurants',
        'Meals – Non Taxable sales tax',
        'Car insurance',
      ],
      'Operating Expense',
      'Operating activities',
    ),
  },
  {
    name: 'Interest & Bank',
    type: 'Operating Expense',
    defaultFor: null,
    cashFlowClassification: 'Operating activities',
    // Two sibling bank-fee leaves named distinctly to stay unique under the
    // (org, name) index.
    children: leaves(
      [
        'Mortgage Interest',
        'Bank Fees CAD$',
        'Bank Fees USD$',
        'Interest & late payment charges',
        'Financing charges',
      ],
      'Operating Expense',
      'Operating activities',
    ),
  },
  {
    name: 'Depreciation',
    type: 'Operating Expense',
    defaultFor: null,
    cashFlowClassification: 'Operating activities',
    children: leaves(
      ['Amortization – car', 'Amortization – buildings'],
      'Operating Expense',
      'Operating activities',
    ),
  },
  {
    name: 'Income Taxes',
    type: 'Operating Expense',
    defaultFor: null,
    cashFlowClassification: 'Operating activities',
    // Recorded tax bills — kept distinct from the computed estimated-tax line
    // in Change §6.
    children: leaves(
      ['Federal Taxes', 'Provincial Taxes', 'Taxes & penalty / Government'],
      'Operating Expense',
      'Operating activities',
    ),
  },
];

/**
 * Idempotent CompanyAccount seeding (Phase 2). One row per org, name derived
 * from the org's slug to match the Buildium pattern (`<slug>.managebuilding.com`
 * — we don't append the suffix in MVP but the name is a stable handle).
 * Public so the company-accounts route can backfill orgs that pre-date Phase 2.
 */
export async function seedCompanyAccount(
  organizationId: Types.ObjectId,
): Promise<void> {
  const org = await Organization.findById(organizationId).lean();
  const name = org?.name ?? org?.slug ?? 'Company';
  await CompanyAccount.updateOne(
    { organizationId },
    {
      $setOnInsert: {
        organizationId,
        name,
        active: true,
      },
    },
    { upsert: true },
  );
}

/**
 * Idempotent system-account seeding. Safe to call multiple times — each row
 * upserts with `$setOnInsert`, so re-running only adds rows the org is missing.
 *
 * Seeds the flat ledger accounts the GL relies on PLUS Ramco's nested chart
 * (Change §0B) in three passes so child `parentId`s can be resolved:
 *   1. top-level (un-grouped) leaves
 *   2. group/header rows (`isGroup: true`, non-postable)
 *   3. leaf rows under each group, stamped with the resolved `parentId`
 *
 * Finishes by stamping `Organization.chartSeedVersion` so the route stops
 * re-running once the org is current.
 *
 * Public so the ChartOfAccount routes can backfill an org that pre-dates the
 * current chart on first read.
 */
export async function seedSystemAccounts(
  organizationId: Types.ObjectId,
): Promise<void> {
  // Pass 1 — top-level leaves.
  await Promise.all(
    SYSTEM_ACCOUNTS.map((a) =>
      ChartOfAccount.updateOne(
        { organizationId, name: a.name },
        {
          $setOnInsert: {
            organizationId,
            name: a.name,
            type: a.type,
            parentId: null,
            isGroup: false,
            defaultFor: a.defaultFor,
            cashFlowClassification: a.cashFlowClassification,
            systemSeeded: true,
            active: true,
          },
        },
        { upsert: true },
      ),
    ),
  );

  // Pass 2 — group/header rows.
  await Promise.all(
    ACCOUNT_GROUPS.map((g) =>
      ChartOfAccount.updateOne(
        { organizationId, name: g.name },
        {
          $setOnInsert: {
            organizationId,
            name: g.name,
            type: g.type,
            parentId: null,
            isGroup: true,
            defaultFor: g.defaultFor,
            cashFlowClassification: g.cashFlowClassification,
            systemSeeded: true,
            active: true,
          },
        },
        { upsert: true },
      ),
    ),
  );

  // Resolve the just-seeded group _ids by name.
  const groupRows = await ChartOfAccount.find({
    organizationId,
    isGroup: true,
  })
    .select('_id name')
    .lean<Array<{ _id: Types.ObjectId; name: string }>>();
  const groupIdByName = new Map(groupRows.map((g) => [g.name, g._id]));

  // Pass 3 — leaves nested under each group.
  await Promise.all(
    ACCOUNT_GROUPS.flatMap((g) => {
      const parentId = groupIdByName.get(g.name) ?? null;
      return g.children.map((c) =>
        ChartOfAccount.updateOne(
          { organizationId, name: c.name },
          {
            $setOnInsert: {
              organizationId,
              name: c.name,
              type: c.type,
              parentId,
              isGroup: false,
              defaultFor: c.defaultFor,
              cashFlowClassification: c.cashFlowClassification,
              systemSeeded: true,
              active: true,
            },
          },
          { upsert: true },
        ),
      );
    }),
  );

  // Stamp the seed version so the lazy upgrade check stops firing.
  await Organization.updateOne(
    { _id: organizationId },
    { $set: { chartSeedVersion: CHART_SEED_VERSION } },
  );
}

export async function seedDefaults(
  organizationId: Types.ObjectId,
): Promise<void> {
  await Promise.all([
    FileCategory.updateOne(
      { organizationId, name: 'Leases' },
      {
        $setOnInsert: {
          organizationId,
          name: 'Leases',
          systemSeeded: true,
          inUseCount: 0,
          active: true,
        },
      },
      { upsert: true },
    ),
    FileCategory.updateOne(
      { organizationId, name: 'Photos' },
      {
        $setOnInsert: {
          organizationId,
          name: 'Photos',
          systemSeeded: true,
          inUseCount: 0,
          active: true,
        },
      },
      { upsert: true },
    ),
    VendorCategory.updateOne(
      { organizationId, class: 'Uncategorized', subCategory: '' },
      {
        $setOnInsert: {
          organizationId,
          class: 'Uncategorized',
          subCategory: '',
          systemSeeded: true,
          active: true,
        },
      },
      { upsert: true },
    ),
    TaskCategory.updateOne(
      { organizationId, name: 'Uncategorized' },
      {
        $setOnInsert: {
          organizationId,
          name: 'Uncategorized',
          systemSeeded: true,
          active: true,
        },
      },
      { upsert: true },
    ),
    ProjectType.updateOne(
      { organizationId, name: 'Uncategorized' },
      {
        $setOnInsert: {
          organizationId,
          name: 'Uncategorized',
          systemSeeded: true,
          active: true,
        },
      },
      { upsert: true },
    ),
    seedSystemAccounts(organizationId),
    seedCompanyAccount(organizationId),
  ]);
}

export default seedDefaults;
