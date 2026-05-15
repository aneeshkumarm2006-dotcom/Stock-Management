// PriceCache — global live-quote cache (Twelve Data). No userId.
// Refs: PDR.md §6 (PriceCache), Tech_Stack.md §Database.
import { Schema, model, models, type Model } from 'mongoose';

export interface IPriceCache {
  ticker: string;
  exchange: string;
  price: number;
  dayChange: number;
  dayChangePct: number;
  high52w?: number;
  low52w?: number;
  open?: number;
  high?: number;
  low?: number;
  volume?: number;
  fetchedAt: Date;
}

const PriceCacheSchema = new Schema<IPriceCache>(
  {
    ticker: { type: String, required: true, uppercase: true, trim: true },
    exchange: { type: String, required: true },
    price: { type: Number, required: true },
    dayChange: { type: Number, required: true },
    dayChangePct: { type: Number, required: true },
    high52w: { type: Number },
    low52w: { type: Number },
    open: { type: Number },
    high: { type: Number },
    low: { type: Number },
    volume: { type: Number },
    fetchedAt: { type: Date, default: Date.now },
  },
  { collection: 'priceCache' },
);

// Indexes: priceCache { ticker: 1, exchange: 1 } unique; { fetchedAt: 1 }.
PriceCacheSchema.index({ ticker: 1, exchange: 1 }, { unique: true });
PriceCacheSchema.index({ fetchedAt: 1 });

export const PriceCache: Model<IPriceCache> =
  (models.PriceCache as Model<IPriceCache>) ??
  model<IPriceCache>('PriceCache', PriceCacheSchema);

export default PriceCache;
