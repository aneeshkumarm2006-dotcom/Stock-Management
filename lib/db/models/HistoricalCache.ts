// HistoricalCache — global OHLCV time-series cache (Twelve Data). No userId.
// Refs: PDR.md §6 (HistoricalCache), Tech_Stack.md §Database.
import { Schema, model, models, type Model } from 'mongoose';

export type HistoricalRange = '1W' | '1M' | '3M' | '6M' | '1Y';

export interface ICandle {
  time: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface IHistoricalCache {
  ticker: string;
  exchange: string;
  range: HistoricalRange;
  candles: ICandle[];
  fetchedAt: Date;
}

const CandleSchema = new Schema<ICandle>(
  {
    time: { type: Date, required: true },
    open: { type: Number, required: true },
    high: { type: Number, required: true },
    low: { type: Number, required: true },
    close: { type: Number, required: true },
    volume: { type: Number, required: true },
  },
  { _id: false },
);

const HistoricalCacheSchema = new Schema<IHistoricalCache>(
  {
    ticker: { type: String, required: true, uppercase: true, trim: true },
    exchange: { type: String, required: true },
    range: {
      type: String,
      required: true,
      enum: ['1W', '1M', '3M', '6M', '1Y'],
    },
    candles: { type: [CandleSchema], default: [] },
    fetchedAt: { type: Date, default: Date.now },
  },
  { collection: 'historicalCache' },
);

// Index: historicalCache { ticker: 1, exchange: 1, range: 1 } unique.
HistoricalCacheSchema.index(
  { ticker: 1, exchange: 1, range: 1 },
  { unique: true },
);

export const HistoricalCache: Model<IHistoricalCache> =
  (models.HistoricalCache as Model<IHistoricalCache>) ??
  model<IHistoricalCache>('HistoricalCache', HistoricalCacheSchema);

export default HistoricalCache;
