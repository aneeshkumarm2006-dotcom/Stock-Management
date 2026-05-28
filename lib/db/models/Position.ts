// Position — per-user holding. Refs: PDR.md §6 (Position), Tech_Stack.md §Database.
//
// `exchange` and `currency` were originally enum-locked to NYSE/NASDAQ/TSX
// and USD/CAD. They are now free strings so any listing Twelve Data's free
// symbol-search returns (LSE, HKEX, ASX, NSE, Euronext, XETRA, …) can be
// stored alongside its native currency. The type aliases stay as `string` so
// existing call sites keep their semantic names without re-narrowing.
import { Schema, model, models, Types, type Model } from 'mongoose';

export type Exchange = string;
export type Currency = string;

export interface IPosition {
  userId: Types.ObjectId; // owner; indexed, required — never client-supplied
  ticker: string;
  exchange: Exchange;
  quantity: number;
  avgBuyPrice: number;
  currency: Currency;
  buyDate?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const PositionSchema = new Schema<IPosition>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    ticker: { type: String, required: true, uppercase: true, trim: true },
    exchange: { type: String, required: true, uppercase: true, trim: true },
    quantity: { type: Number, required: true, min: 0 },
    avgBuyPrice: { type: Number, required: true, min: 0 },
    currency: { type: String, required: true, uppercase: true, trim: true },
    buyDate: { type: Date },
  },
  { timestamps: true, collection: 'positions' },
);

// Indexes: positions { userId: 1 }; { userId: 1, ticker: 1, exchange: 1 }.
PositionSchema.index({ userId: 1 });
PositionSchema.index({ userId: 1, ticker: 1, exchange: 1 });

export const Position: Model<IPosition> =
  (models.Position as Model<IPosition>) ??
  model<IPosition>('Position', PositionSchema);

export default Position;
