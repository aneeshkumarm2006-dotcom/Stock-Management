// ApiUsage — global per-provider per-day usage counter. No userId.
// Refs: PDR.md §6 (ApiUsage), PDR.md §8, Tech_Stack.md §Database.
import { Schema, model, models, type Model } from 'mongoose';

export type ApiProvider = 'twelvedata' | 'finnhub' | 'exchangerate';

export interface IApiUsage {
  provider: ApiProvider;
  date: string; // YYYY-MM-DD
  calls: number;
  credits: number;
}

const ApiUsageSchema = new Schema<IApiUsage>(
  {
    provider: {
      type: String,
      required: true,
      enum: ['twelvedata', 'finnhub', 'exchangerate'],
    },
    date: { type: String, required: true }, // YYYY-MM-DD
    calls: { type: Number, default: 0 },
    credits: { type: Number, default: 0 },
  },
  { collection: 'apiUsage' },
);

// Index: apiUsage { provider: 1, date: 1 } unique.
ApiUsageSchema.index({ provider: 1, date: 1 }, { unique: true });

export const ApiUsage: Model<IApiUsage> =
  (models.ApiUsage as Model<IApiUsage>) ??
  model<IApiUsage>('ApiUsage', ApiUsageSchema);

export default ApiUsage;
