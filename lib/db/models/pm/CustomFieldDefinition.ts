// CustomFieldDefinition — org-scoped custom field definitions (BR-CX-3).
// Once defined, the field appears on every record of that `entityType`.
// Values land on the consuming entity's `customFields` map (Phase 1+).
// Refs: PROPERTY_TODO.md Phase 0 §Org settings.
import { Schema, model, models, Types, type Model } from 'mongoose';
import type { CustomFieldType } from '@/types/pm';

export interface ICustomFieldDefinition {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  /**
   * Target entity type — superset of ParentType (Property, Unit, Lease, …)
   * and includes entities that aren't note/activity parents (e.g. Bill).
   * Kept as a freeform string for forward-compat — validated at the API layer.
   */
  entityType: string;
  /** Stable machine key (e.g. `pet_weight_limit`). */
  key: string;
  /** Human label (e.g. `Pet weight limit (lbs)`). */
  label: string;
  fieldType: CustomFieldType;
  /** Required only when fieldType === 'enum'. */
  enumOptions?: string[];
  required: boolean;
  /** Render order on the entity detail. */
  order: number;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const CustomFieldDefinitionSchema = new Schema<ICustomFieldDefinition>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'PmOrganization',
      required: true,
    },
    entityType: { type: String, required: true, trim: true },
    key: { type: String, required: true, trim: true },
    label: { type: String, required: true, trim: true },
    fieldType: {
      type: String,
      enum: ['text', 'number', 'date', 'boolean', 'enum'],
      required: true,
    },
    enumOptions: { type: [String], default: undefined },
    required: { type: Boolean, default: false },
    order: { type: Number, default: 0 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true, collection: 'pm_custom_field_definitions' },
);

CustomFieldDefinitionSchema.index(
  { organizationId: 1, entityType: 1, key: 1 },
  { unique: true },
);
CustomFieldDefinitionSchema.index({ organizationId: 1, entityType: 1 });

export const CustomFieldDefinition: Model<ICustomFieldDefinition> =
  (models.PmCustomFieldDefinition as Model<ICustomFieldDefinition>) ??
  model<ICustomFieldDefinition>(
    'PmCustomFieldDefinition',
    CustomFieldDefinitionSchema,
  );

export default CustomFieldDefinition;
