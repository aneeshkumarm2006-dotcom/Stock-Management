// Settings — one per-user preferences doc. Refs: PDR.md §6 (Settings),
// PDR.md §5.7, Tech_Stack.md §Database.
import { Schema, model, models, Types, type Model } from 'mongoose';

export type Currency = 'USD' | 'CAD';
export type Theme = 'dark' | 'light';
export type NumberFormat = '1,234.56' | '1.234,56' | '1234.56';

export interface ISettings {
  userId: Types.ObjectId; // owner; one Settings doc per user, unique
  defaultCurrency: Currency;
  theme: Theme;
  numberFormat: NumberFormat;
}

const SettingsSchema = new Schema<ISettings>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    defaultCurrency: {
      type: String,
      enum: ['USD', 'CAD'],
      default: 'USD',
    },
    theme: { type: String, enum: ['dark', 'light'], default: 'light' },
    numberFormat: {
      type: String,
      enum: ['1,234.56', '1.234,56', '1234.56'],
      default: '1,234.56',
    },
  },
  { collection: 'settings' },
);

// Index: settings { userId: 1 } unique.
SettingsSchema.index({ userId: 1 }, { unique: true });

export const Settings: Model<ISettings> =
  (models.Settings as Model<ISettings>) ??
  model<ISettings>('Settings', SettingsSchema);

export default Settings;
