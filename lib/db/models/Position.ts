// Position — per-user holding. Refs: PDR.md §6 (Position), Tech_Stack.md §Database.
import { Schema, model, models, Types, type Model } from 'mongoose';

export type Exchange = 'NYSE' | 'NASDAQ' | 'TSX';
export type Currency = 'USD' | 'CAD';

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
    exchange: {
      type: String,
      required: true,
      enum: ['NYSE', 'NASDAQ', 'TSX'],
    },
    quantity: { type: Number, required: true, min: 0 },
    avgBuyPrice: { type: Number, required: true, min: 0 },
    currency: { type: String, required: true, enum: ['USD', 'CAD'] },
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
