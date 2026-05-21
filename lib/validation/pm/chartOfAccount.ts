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

const DEFAULT_FOR = [
  'Accounts Payable',
  'Accounts Receivable',
  'Application Fee Income',
  'Bank Fees',
  'Convenience Fee',
  "Last Month's Rent",
  'Late Fee Income',
  'Management Fee Income',
  'Operating Cash',
  'Security Deposit Liability',
  'Undeposited Funds',
] as const;

export const chartOfAccountCreateSchema = z.object({
  name: z.string().min(1).max(120),
  type: z.enum(TYPES),
  defaultFor: z.enum(DEFAULT_FOR).nullable().optional(),
  cashFlowClassification: z.enum(CASH_FLOW).optional(),
  accountNumber: z.string().max(40).optional(),
  notes: z.string().max(2000).optional(),
});

export const chartOfAccountUpdateSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    type: z.enum(TYPES).optional(),
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
