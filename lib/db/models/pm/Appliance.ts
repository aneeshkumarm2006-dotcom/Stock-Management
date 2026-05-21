// Appliance — child of Unit (PDR §3.30). Surfaced on Unit → Appliances tab
// and rolled up onto Property → Summary. Phase 4 may add appliance-scoped
// WorkOrders (inferred ref).
import { Schema, model, models, Types, type Model } from 'mongoose';

export interface IAppliance {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  unitId: Types.ObjectId;
  name: string;
  installedDate?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const ApplianceSchema = new Schema<IAppliance>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'PmOrganization',
      required: true,
    },
    unitId: {
      type: Schema.Types.ObjectId,
      ref: 'PmUnit',
      required: true,
    },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    installedDate: { type: Date, default: null },
  },
  { timestamps: true, collection: 'pm_appliances' },
);

ApplianceSchema.index({ organizationId: 1, unitId: 1, name: 1 });

export const Appliance: Model<IAppliance> =
  (models.PmAppliance as Model<IAppliance>) ??
  model<IAppliance>('PmAppliance', ApplianceSchema);

export default Appliance;
