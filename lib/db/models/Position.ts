// Position — per-user holding. Refs: PDR.md §6 (Position), Tech_Stack.md §Database.
//
// `exchange` and `currency` were originally enum-locked to NYSE/NASDAQ/TSX
// and USD/CAD. They are now free strings so any listing Twelve Data's free
// symbol-search returns (LSE, HKEX, ASX, NSE, Euronext, XETRA, …) can be
// stored alongside its native currency. The type aliases stay as `string` so
// existing call sites keep their semantic names without re-narrowing.
//
// A single collection now backs every asset type via the `assetType`
// discriminator: EQUITY (stocks/ETFs, the original shape, priced live from
// Twelve Data) plus GIC / BOND (fixed income, auto-calculated maturity value),
// MUTUAL_FUND (private fund, manual monthly market value) and CASH (manual
// value). The equity-only fields are now optional so the non-equity types can
// omit them; the discriminated zod schema in the API enforces the per-type
// requirements. Legacy equity docs have no `assetType`; readers coalesce
// `assetType ?? 'EQUITY'`, so no migration is required.
import { Schema, model, models, Types, type Model } from 'mongoose';

export type Exchange = string;
export type Currency = string;

export type AssetType = 'EQUITY' | 'GIC' | 'BOND' | 'MUTUAL_FUND' | 'CASH';

/** Compounding / payout cadence for fixed-income holdings (GIC/Bond). */
export type PayoutFrequency =
  | 'MONTHLY'
  | 'QUARTERLY'
  | 'SEMI_ANNUAL'
  | 'ANNUAL'
  | 'AT_MATURITY';

export interface IPosition {
  userId: Types.ObjectId; // owner; indexed, required — never client-supplied
  /** Discriminator. Absent on legacy docs → treat as 'EQUITY'. */
  assetType: AssetType;
  // --- EQUITY (stocks/ETFs) — optional so non-equity types can omit them ---
  ticker?: string;
  exchange?: Exchange;
  quantity?: number;
  avgBuyPrice?: number;
  buyDate?: Date;
  // --- Common to every type ---
  currency: Currency;
  /** Optional "held-by" company (ref Company). Null/absent = unassigned. */
  companyId?: Types.ObjectId | null;
  // --- Non-equity: user-supplied display name ---
  label?: string;
  // --- GIC / BOND (fixed income) ---
  institution?: string; // bank (GIC) / issuer (Bond)
  principal?: number; // invested / book value
  startDate?: Date;
  maturityDate?: Date;
  interestRate?: number; // annual %, e.g. 4.5 means 4.5%
  payoutFrequency?: PayoutFrequency;
  // --- MUTUAL_FUND / CASH (manual valuation) ---
  costBasis?: number; // fund book value (what was paid)
  currentValue?: number; // manually-entered current market value
  valueAsOf?: Date; // when currentValue was last set (drives the stale dot)
  createdAt: Date;
  updatedAt: Date;
}

const PositionSchema = new Schema<IPosition>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    assetType: {
      type: String,
      enum: ['EQUITY', 'GIC', 'BOND', 'MUTUAL_FUND', 'CASH'],
      default: 'EQUITY',
      required: true,
    },
    // Equity fields — optional now (validated per-type in the API layer).
    ticker: { type: String, uppercase: true, trim: true },
    exchange: { type: String, uppercase: true, trim: true },
    quantity: { type: Number, min: 0 },
    avgBuyPrice: { type: Number, min: 0 },
    buyDate: { type: Date },
    // Common.
    currency: { type: String, required: true, uppercase: true, trim: true },
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', default: null },
    // Non-equity display name.
    label: { type: String, trim: true, maxlength: 120 },
    // Fixed income (GIC/Bond).
    institution: { type: String, trim: true, maxlength: 120 },
    principal: { type: Number, min: 0 },
    startDate: { type: Date },
    maturityDate: { type: Date },
    interestRate: { type: Number, min: 0 },
    payoutFrequency: {
      type: String,
      enum: ['MONTHLY', 'QUARTERLY', 'SEMI_ANNUAL', 'ANNUAL', 'AT_MATURITY'],
    },
    // Manual valuation (Mutual fund / Cash).
    costBasis: { type: Number, min: 0 },
    currentValue: { type: Number, min: 0 },
    valueAsOf: { type: Date },
  },
  { timestamps: true, collection: 'positions' },
);

// Indexes: positions { userId: 1 }; { userId: 1, ticker: 1, exchange: 1 }.
// { userId: 1, companyId: 1 } backs the held-by usage count + block-on-delete.
PositionSchema.index({ userId: 1 });
PositionSchema.index({ userId: 1, ticker: 1, exchange: 1 });
PositionSchema.index({ userId: 1, companyId: 1 });

export const Position: Model<IPosition> =
  (models.Position as Model<IPosition>) ??
  model<IPosition>('Position', PositionSchema);

export default Position;
