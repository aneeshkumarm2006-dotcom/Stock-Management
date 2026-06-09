// Shared zod schemas + serialization for multi-asset holdings (Position).
// One discriminated union on `assetType` backs both POST /api/positions and
// the per-type PATCH; the serializer returns every stored field so the client
// can render type-specific columns. Refs: plan §3.
import { z } from 'zod';
import type { IPosition } from '@/lib/db/models/Position';

/** '' / null / undefined → null; otherwise a 24-char hex ObjectId. */
export const companyIdSchema = z
  .preprocess(
    (v) => (v === '' || v === null || v === undefined ? null : v),
    z.union([z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid company'), z.null()]),
  )
  .optional();

const currency = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, 'Currency must be a 3-letter ISO code');

const label = z.string().trim().min(1, 'Name is required').max(120);
const institution = z.string().trim().min(1, 'Institution is required').max(120);
const payoutFrequency = z.enum([
  'MONTHLY',
  'QUARTERLY',
  'SEMI_ANNUAL',
  'ANNUAL',
  'AT_MATURITY',
]);

// --- EQUITY (stocks/ETFs) — the original shape ---------------------------
const equityCreate = z.object({
  assetType: z.literal('EQUITY'),
  ticker: z.string().trim().toUpperCase().min(1, 'Ticker is required').max(20),
  exchange: z
    .string()
    .trim()
    .toUpperCase()
    .min(1, 'Exchange is required')
    .max(32, 'Exchange code is too long'),
  quantity: z.number().positive('Quantity must be greater than 0'),
  avgBuyPrice: z.number().min(0, 'Average buy price cannot be negative'),
  currency,
  buyDate: z.coerce.date().optional(),
  companyId: companyIdSchema,
});

// --- GIC / BOND (fixed income) — identical shape -------------------------
const fixedIncomeFields = {
  label,
  institution,
  principal: z.number().positive('Principal must be greater than 0'),
  currency,
  startDate: z.coerce.date(),
  maturityDate: z.coerce.date(),
  interestRate: z.number().min(0, 'Interest rate cannot be negative'),
  payoutFrequency,
  companyId: companyIdSchema,
};
// NOTE: discriminatedUnion members must be plain ZodObjects (no .refine), so
// the maturity-after-start check is applied via .superRefine on the union.
const gicCreate = z.object({ assetType: z.literal('GIC'), ...fixedIncomeFields });
const bondCreate = z.object({ assetType: z.literal('BOND'), ...fixedIncomeFields });

// --- MUTUAL_FUND (private, manual monthly value) -------------------------
const mutualFundCreate = z.object({
  assetType: z.literal('MUTUAL_FUND'),
  label,
  currency,
  costBasis: z.number().min(0, 'Cost cannot be negative'),
  currentValue: z.number().min(0, 'Current value cannot be negative'),
  valueAsOf: z.coerce.date().optional(),
  companyId: companyIdSchema,
});

// --- CASH / OTHER (manual value) -----------------------------------------
const cashCreate = z.object({
  assetType: z.literal('CASH'),
  label,
  currency,
  currentValue: z.number().min(0, 'Value cannot be negative'),
  companyId: companyIdSchema,
});

/**
 * Discriminated create schema. A missing `assetType` defaults to 'EQUITY' so
 * any un-updated client keeps working against the new endpoint.
 */
export const createHoldingSchema = z.preprocess(
  (v) => {
    if (v && typeof v === 'object' && !('assetType' in v)) {
      return { ...(v as Record<string, unknown>), assetType: 'EQUITY' };
    }
    return v;
  },
  z
    .discriminatedUnion('assetType', [
      equityCreate,
      gicCreate,
      bondCreate,
      mutualFundCreate,
      cashCreate,
    ])
    .superRefine((d, ctx) => {
      if (
        (d.assetType === 'GIC' || d.assetType === 'BOND') &&
        d.maturityDate <= d.startDate
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['maturityDate'],
          message: 'Maturity date must be after the start date',
        });
      }
    }),
);

export type CreateHoldingInput = z.infer<typeof createHoldingSchema>;

// --- PATCH: a superset "replace" whose fields are applied per the doc's type.
// Plus the mutual-fund one-tap value refresh and the equity add-to-position.
export const equityAddSchema = z.object({
  mode: z.literal('add'),
  addQuantity: z.number().positive('Added quantity must be greater than 0'),
  addPrice: z.number().min(0, 'Added price cannot be negative'),
});

export const updateValueSchema = z.object({
  mode: z.literal('updateValue'),
  currentValue: z.number().min(0, 'Value cannot be negative'),
});

export const replaceSchema = z
  .object({
    mode: z.literal('replace').optional(),
    // Equity
    quantity: z.number().positive('Quantity must be greater than 0').optional(),
    avgBuyPrice: z.number().min(0, 'Average buy price cannot be negative').optional(),
    // Common
    label: z.string().trim().min(1).max(120).optional(),
    currency: currency.optional(),
    companyId: companyIdSchema,
    // Fixed income
    institution: z.string().trim().min(1).max(120).optional(),
    principal: z.number().positive('Principal must be greater than 0').optional(),
    startDate: z.coerce.date().optional(),
    maturityDate: z.coerce.date().optional(),
    interestRate: z.number().min(0, 'Interest rate cannot be negative').optional(),
    payoutFrequency: payoutFrequency.optional(),
    // Manual valuation
    costBasis: z.number().min(0, 'Cost cannot be negative').optional(),
    currentValue: z.number().min(0, 'Value cannot be negative').optional(),
    valueAsOf: z.coerce.date().optional(),
  })
  .refine((d) => Object.keys(d).some((k) => k !== 'mode' && (d as Record<string, unknown>)[k] !== undefined), {
    message: 'Provide at least one field to update',
  });

export const patchHoldingSchema = z.union([
  equityAddSchema,
  updateValueSchema,
  replaceSchema,
]);

/** Serialize a Position doc to the wire shape, including every asset field. */
export function serializeHolding(p: Partial<IPosition> & { _id: unknown }) {
  const assetType = p.assetType ?? 'EQUITY';
  return {
    id: String(p._id),
    assetType,
    ticker: p.ticker ?? null,
    exchange: p.exchange ?? null,
    quantity: p.quantity ?? null,
    avgBuyPrice: p.avgBuyPrice ?? null,
    currency: p.currency,
    buyDate: p.buyDate ?? null,
    companyId: p.companyId ? String(p.companyId) : null,
    label: p.label ?? null,
    institution: p.institution ?? null,
    principal: p.principal ?? null,
    startDate: p.startDate ?? null,
    maturityDate: p.maturityDate ?? null,
    interestRate: p.interestRate ?? null,
    payoutFrequency: p.payoutFrequency ?? null,
    costBasis: p.costBasis ?? null,
    currentValue: p.currentValue ?? null,
    valueAsOf: p.valueAsOf ?? null,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}
