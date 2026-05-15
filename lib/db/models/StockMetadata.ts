// StockMetadata — global company profile cache (Finnhub). No userId.
// Refs: PDR.md §6 (StockMetadata), Tech_Stack.md §Database.
import { Schema, model, models, type Model } from 'mongoose';

export type Country = 'US' | 'CA';

export interface IStockMetadata {
  ticker: string;
  exchange: string;
  name?: string;
  logo?: string;
  sector?: string;
  industry?: string;
  country?: Country;
  lastUpdated: Date;
}

const StockMetadataSchema = new Schema<IStockMetadata>(
  {
    ticker: { type: String, required: true, uppercase: true, trim: true },
    exchange: { type: String, required: true },
    name: { type: String },
    logo: { type: String },
    sector: { type: String },
    industry: { type: String },
    country: { type: String, enum: ['US', 'CA'] },
    lastUpdated: { type: Date, default: Date.now },
  },
  { collection: 'stockMetadata' },
);

// Index: stockMetadata { ticker: 1, exchange: 1 } unique.
StockMetadataSchema.index({ ticker: 1, exchange: 1 }, { unique: true });

export const StockMetadata: Model<IStockMetadata> =
  (models.StockMetadata as Model<IStockMetadata>) ??
  model<IStockMetadata>('StockMetadata', StockMetadataSchema);

export default StockMetadata;
