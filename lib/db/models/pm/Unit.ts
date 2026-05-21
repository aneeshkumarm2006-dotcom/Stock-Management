// Unit — child of Property (PDR §3.2). Unit IDs are unique within a property,
// not globally. Derived fields (`address`, `currentTenants`, `mostRecentEvent`)
// are computed by the route on read; Phase 1 returns the address rollup and
// the latest ActivityLogEntry, with `currentTenants` empty until Phase 3.
import { Schema, model, models, Types, type Model } from 'mongoose';

export interface IUnit {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  propertyId: Types.ObjectId;
  unitId: string;
  bedrooms?: number;
  bathrooms?: string;
  sizeSqft?: number;
  description?: string;
  amenities: string[];
  createdAt: Date;
  updatedAt: Date;
}

const UnitSchema = new Schema<IUnit>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'PmOrganization',
      required: true,
    },
    propertyId: {
      type: Schema.Types.ObjectId,
      ref: 'PmProperty',
      required: true,
    },
    unitId: { type: String, required: true, trim: true, maxlength: 40 },
    bedrooms: { type: Number, min: 0 },
    bathrooms: { type: String, trim: true, maxlength: 8 },
    sizeSqft: { type: Number, min: 0 },
    description: { type: String, maxlength: 4000 },
    amenities: { type: [String], default: [] },
  },
  { timestamps: true, collection: 'pm_units' },
);

// Unit IDs unique within a property.
UnitSchema.index(
  { organizationId: 1, propertyId: 1, unitId: 1 },
  { unique: true },
);

export const Unit: Model<IUnit> =
  (models.PmUnit as Model<IUnit>) ?? model<IUnit>('PmUnit', UnitSchema);

export default Unit;
