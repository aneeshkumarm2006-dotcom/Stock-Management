// MarketDataCache — generic global key/value cache for indices, movers,
// sector heatmap, 52w lists. No userId.
// Refs: PDR.md §6 (MarketDataCache), Tech_Stack.md §Database.
import { Schema, model, models, type Model } from 'mongoose';

export interface IMarketDataCache {
  key: string;
  payload: unknown;
  fetchedAt: Date;
}

const MarketDataCacheSchema = new Schema<IMarketDataCache>(
  {
    key: { type: String, required: true },
    payload: { type: Schema.Types.Mixed, required: true },
    fetchedAt: { type: Date, default: Date.now },
  },
  { collection: 'marketDataCache' },
);

// Index: marketDataCache { key: 1 } unique.
MarketDataCacheSchema.index({ key: 1 }, { unique: true });

export const MarketDataCache: Model<IMarketDataCache> =
  (models.MarketDataCache as Model<IMarketDataCache>) ??
  model<IMarketDataCache>('MarketDataCache', MarketDataCacheSchema);

export default MarketDataCache;
