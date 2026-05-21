// Note — polymorphic cross-cutting record (PDR_MASTER §3.33).
// Notes tab on every detail page is driven by this collection.
// `noteType` enum is provisional (DECISIONS.md [G-S-19]).
import { Schema, model, models, Types, type Model } from 'mongoose';
import { PARENT_TYPES } from '@/lib/pm/parentTypes';
import type { NoteType, ParentType } from '@/types/pm';

const NOTE_TYPES: NoteType[] = [
  'RENTAL',
  'MAINTENANCE',
  'LEASING',
  'ACCOUNTING',
  'GENERAL',
];

export interface INote {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  parentType: ParentType;
  parentId: Types.ObjectId;
  body: string;
  noteType: NoteType;
  updatedByUserId: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const NoteSchema = new Schema<INote>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'PmOrganization',
      required: true,
    },
    parentType: { type: String, enum: PARENT_TYPES, required: true },
    parentId: { type: Schema.Types.ObjectId, required: true },
    body: { type: String, required: true },
    noteType: {
      type: String,
      enum: NOTE_TYPES,
      required: true,
      default: 'RENTAL',
    },
    updatedByUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  { timestamps: true, collection: 'pm_notes' },
);

NoteSchema.index({ organizationId: 1, parentType: 1, parentId: 1, createdAt: -1 });

export const Note: Model<INote> =
  (models.PmNote as Model<INote>) ?? model<INote>('PmNote', NoteSchema);

export default Note;
