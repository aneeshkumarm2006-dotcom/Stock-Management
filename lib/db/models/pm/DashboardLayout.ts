// DashboardLayout — per-user widget layout for the PM Dashboard (PROPERTY_TODO.md
// Phase 10 [G-B-10]). One row per (organizationId, userId). Items[] mirrors
// the widget registry: enabled toggles visibility, order drives render
// sequence. The route upserts on first GET so the model always has a row by
// the time the user sees the dashboard.
import { Schema, model, models, Types, type Model } from 'mongoose';

export interface IDashboardLayoutItem {
  widgetId: string;
  enabled: boolean;
  order: number;
}

export interface IDashboardLayout {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  userId: Types.ObjectId;
  items: IDashboardLayoutItem[];
  createdAt: Date;
  updatedAt: Date;
}

const DashboardLayoutItemSchema = new Schema<IDashboardLayoutItem>(
  {
    widgetId: { type: String, required: true, trim: true, maxlength: 64 },
    enabled: { type: Boolean, default: true },
    order: { type: Number, default: 0, min: 0 },
  },
  { _id: false },
);

const DashboardLayoutSchema = new Schema<IDashboardLayout>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'PmOrganization',
      required: true,
    },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    items: { type: [DashboardLayoutItemSchema], default: () => [] },
  },
  { timestamps: true, collection: 'pm_dashboard_layouts' },
);

DashboardLayoutSchema.index(
  { organizationId: 1, userId: 1 },
  { unique: true },
);

export const DashboardLayout: Model<IDashboardLayout> =
  (models.PmDashboardLayout as Model<IDashboardLayout>) ??
  model<IDashboardLayout>('PmDashboardLayout', DashboardLayoutSchema);

export default DashboardLayout;
