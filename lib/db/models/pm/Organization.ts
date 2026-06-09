// Organization — top-level container for every PM record (Phase 0).
// One Organization is auto-provisioned per user on first PM access; later
// phases can add multi-user memberships without a schema migration.
// Refs: PROPERTY_TODO.md Phase 0 §Org settings; BR-CX-1 (trial gating),
// BR-AC-2 (cash vs accrual), BR-CC-5 (sender mailbox), BR-CX-5 (USD assumed).
import { Schema, model, models, Types, type Model } from 'mongoose';
import type {
  AccountingMode,
  SubscriptionStatus,
} from '@/types/pm';

const TRIAL_DAYS = 14;

export interface ISenderMailbox {
  /** Default From address used when no per-property override applies. */
  defaultFrom?: string;
  /**
   * Per-property override map (DECISIONS.md [G-B-21]). Keyed by Property._id
   * stringified; value is the mailbox address.
   */
  perPropertyOverrides?: Map<string, string>;
}

export interface IOrganization {
  _id: Types.ObjectId;
  name: string;
  /** URL-safe slug; unique. */
  slug: string;
  ownerUserId: Types.ObjectId;
  /**
   * IANA timezone (e.g. `America/New_York`). CalendarEvent inherits this
   * read-only (BR-CC-9). Phase 0a [G-B-23] formalizes scheduled-send anchor.
   */
  timezone: string;
  /** MM-DD start of fiscal year (default 01-01 per §3.26). [G-S-35] */
  fiscalYearStart: string;
  /** Global toggle (BR-AC-2). Recomputes views; never modifies journal rows. */
  accountingMode: AccountingMode;
  /**
   * Org-level reporting currency. USD or CAD (Ramco books in CAD). Single
   * org-level currency — not per-transaction multi-currency. Stored cents are
   * currency-agnostic; only the rendered symbol changes. Change §0A.
   */
  defaultCurrency: 'USD' | 'CAD';
  /**
   * Estimated income-tax rate (percent, 0–100) used by the company-financials
   * report to derive an "estimated income taxes" display line. Never posts a
   * GL liability. Defaults to 0 → the tax line reads $0 until configured.
   * Change §0C.
   */
  estimatedIncomeTaxRatePct: number;
  /**
   * Monotonic stamp of the chart-of-accounts seed the org has been provisioned
   * with. Lets us re-seed orgs that pre-date a chart upgrade without silently
   * double-seeding (Change §0B). Defaults to 0 for legacy orgs.
   */
  chartSeedVersion: number;
  /** Sender mailbox config (BR-CC-5). [G-B-21] */
  senderMailbox: ISenderMailbox;
  /** When the free trial ends (BR-CX-1). */
  trialEndsAt: Date;
  subscriptionStatus: SubscriptionStatus;
  /** Soft archive — preserves historical references. */
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const SenderMailboxSchema = new Schema<ISenderMailbox>(
  {
    defaultFrom: { type: String, trim: true },
    perPropertyOverrides: { type: Map, of: String, default: undefined },
  },
  { _id: false },
);

const OrganizationSchema = new Schema<IOrganization>(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, trim: true, lowercase: true },
    ownerUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    timezone: { type: String, required: true, default: 'America/New_York' },
    fiscalYearStart: { type: String, required: true, default: '01-01' },
    accountingMode: {
      type: String,
      enum: ['cash', 'accrual'],
      default: 'accrual',
    },
    defaultCurrency: { type: String, enum: ['USD', 'CAD'], default: 'USD' },
    estimatedIncomeTaxRatePct: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    chartSeedVersion: { type: Number, default: 0 },
    senderMailbox: { type: SenderMailboxSchema, default: () => ({}) },
    trialEndsAt: {
      type: Date,
      required: true,
      default: () =>
        new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000),
    },
    subscriptionStatus: {
      type: String,
      enum: ['trial', 'active', 'expired'],
      default: 'trial',
    },
    active: { type: Boolean, default: true },
  },
  { timestamps: true, collection: 'pm_organizations' },
);

OrganizationSchema.index({ slug: 1 }, { unique: true });
OrganizationSchema.index({ ownerUserId: 1 });

export const Organization: Model<IOrganization> =
  (models.PmOrganization as Model<IOrganization>) ??
  model<IOrganization>('PmOrganization', OrganizationSchema);

export default Organization;
