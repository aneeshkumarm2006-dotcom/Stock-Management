// Zod validators for ChartOfAccount routes. DECISIONS.md [G-S-12]/[G-S-13]/[G-S-14].
import { z } from 'zod';

const TYPES = [
  'Current Asset',
  'Current Asset (cash)',
  'Fixed Asset',
  'Current Liability',
  'Long-term Liability',
  'Equity',
  'Income',
  'Operating Expense',
] as const;

const CASH_FLOW = [
  'Operating activities',
  'Investing activities',
  'Financing activities',
  'N/A',
] as const;

// Kept in sync with ChartOfAccountDefaultFor in types/pm.ts + the model's
// CHART_OF_ACCOUNT_DEFAULT_FOR (Change §0B de-staled this list — it had been
// missing Bank Service Charges, Interest Income, Management Fee Expense, and
// Owner Contribution — and added Investment Income for Change §6).
const DEFAULT_FOR = [
  'Accounts Payable',
  'Accounts Receivable',
  'Application Fee Income',
  'Bank Fees',
  'Bank Service Charges',
  'Convenience Fee',
  'Interest Income',
  'Investment Income',
  "Last Month's Rent",
  'Late Fee Income',
  'Management Fee Expense',
  'Management Fee Income',
  'Operating Cash',
  'Owner Contribution',
  'Security Deposit Liability',
  'Undeposited Funds',
] as const;

// Accept a 24-char hex ObjectId string for parentId (or null to un-nest).
const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');

export const chartOfAccountCreateSchema = z.object({
  name: z.string().min(1).max(120),
  type: z.enum(TYPES),
  parentId: objectId.nullable().optional(),
  isGroup: z.boolean().optional(),
  defaultFor: z.enum(DEFAULT_FOR).nullable().optional(),
  cashFlowClassification: z.enum(CASH_FLOW).optional(),
  accountNumber: z.string().max(40).optional(),
  notes: z.string().max(2000).optional(),
});

export const chartOfAccountUpdateSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    type: z.enum(TYPES).optional(),
    parentId: objectId.nullable().optional(),
    isGroup: z.boolean().optional(),
    defaultFor: z.enum(DEFAULT_FOR).nullable().optional(),
    cashFlowClassification: z.enum(CASH_FLOW).optional(),
    accountNumber: z.string().max(40).optional(),
    notes: z.string().max(2000).optional(),
    active: z.boolean().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: 'No fields to update',
  });

export type ChartOfAccountCreate = z.infer<typeof chartOfAccountCreateSchema>;
export type ChartOfAccountUpdate = z.infer<typeof chartOfAccountUpdateSchema>;
