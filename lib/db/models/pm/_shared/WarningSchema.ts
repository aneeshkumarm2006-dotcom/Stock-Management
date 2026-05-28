// Shared sub-schema for the `warnings: PmWarning[]` field that every
// warningable PM entity gets. Centralising this means future shape edits
// (e.g. adding `severity`) are a one-touch change.
import { Schema } from 'mongoose';

export interface IWarning {
  code: string;
  message: string;
  dismissedAt?: Date | null;
}

export const WarningSchema = new Schema<IWarning>(
  {
    code: { type: String, required: true },
    message: { type: String, required: true },
    dismissedAt: { type: Date, default: null },
  },
  { _id: false },
);
