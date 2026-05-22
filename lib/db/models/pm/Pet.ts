// Pet — animal record attached to a Lease (PDR_MASTER §3.32). `ownerTenantId`
// scopes the pet to a specific tenant on the lease so move-outs cleanly drop
// the pet roll-up alongside the resident. `assistanceAnimal=true` flags
// service/ESA animals that are exempted from pet-fee rules.
import { Schema, model, models, Types, type Model } from 'mongoose';
import type { PetType } from '@/types/pm';
import { PET_TYPES } from '@/types/pm';

export interface IPet {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  leaseId: Types.ObjectId;
  ownerTenantId?: Types.ObjectId | null;
  name: string;
  petType: PetType;
  breed?: string;
  weightLbs?: number;
  ageYears?: number;
  licenseNumber?: string;
  assistanceAnimal: boolean;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const PetSchema = new Schema<IPet>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'PmOrganization',
      required: true,
    },
    leaseId: {
      type: Schema.Types.ObjectId,
      ref: 'PmLease',
      required: true,
    },
    ownerTenantId: {
      type: Schema.Types.ObjectId,
      ref: 'PmTenant',
      default: null,
    },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    petType: {
      type: String,
      enum: PET_TYPES,
      required: true,
    },
    breed: { type: String, trim: true, maxlength: 80 },
    weightLbs: { type: Number, min: 0, max: 500 },
    ageYears: { type: Number, min: 0, max: 100 },
    licenseNumber: { type: String, trim: true, maxlength: 80 },
    assistanceAnimal: { type: Boolean, default: false },
    notes: { type: String, maxlength: 2000 },
  },
  { timestamps: true, collection: 'pm_pets' },
);

PetSchema.index({ organizationId: 1, leaseId: 1 });

export const Pet: Model<IPet> =
  (models.PmPet as Model<IPet>) ?? model<IPet>('PmPet', PetSchema);

export default Pet;
