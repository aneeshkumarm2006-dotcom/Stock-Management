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

interface SystemAccountSeed {
  name: string;
  type: ChartOfAccountType;
  defaultFor: ChartOfAccountDefaultFor | null;
  cashFlowClassification: CashFlowClassification;
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
 * Idempotent system-account seeding. Safe to call multiple times.
 * Public so the ChartOfAccount routes can backfill an org that pre-dates
 * Phase 1 on first read.
 */
export async function seedSystemAccounts(
  organizationId: Types.ObjectId,
): Promise<void> {
  await Promise.all(
    SYSTEM_ACCOUNTS.map((a) =>
      ChartOfAccount.updateOne(
        { organizationId, name: a.name },
        {
          $setOnInsert: {
            organizationId,
            name: a.name,
            type: a.type,
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
