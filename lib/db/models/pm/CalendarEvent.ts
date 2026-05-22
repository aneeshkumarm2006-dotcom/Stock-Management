// CalendarEvent — Phase 4 stub for BR-MV-7. Full surface (recurrence,
// reminders, drag-to-reschedule, ICS export) lands in Phase 7 §3.34.
// This stub exists solely so the WorkOrder → "Create work order and
// schedule event" action has a real persisted record to write against.
//
// Lifecycle: Phase 4 only POSTs; Phase 7 fills GET/PATCH/DELETE and the
// grid surface. Until then the row sits in pm_calendar_events as an
// auditable trace of the WO scheduling intent.
import { Schema, model, models, Types, type Model } from 'mongoose';
import { PARENT_TYPES } from '@/lib/pm/parentTypes';
import type { ParentType } from '@/types/pm';

export interface ICalendarEvent {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  /** Polymorphic parent — WorkOrder for Phase 4; expanded in Phase 7. */
  parentType: ParentType;
  parentId: Types.ObjectId;
  title: string;
  description?: string;
  startDate: Date;
  endDate?: Date | null;
  allDay: boolean;
  /** Stamped by the originating route; e.g. 'WorkOrder' for BR-MV-7. */
  source: string;
  createdByUserId: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const CalendarEventSchema = new Schema<ICalendarEvent>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'PmOrganization',
      required: true,
    },
    parentType: {
      type: String,
      enum: PARENT_TYPES,
      required: true,
    },
    parentId: { type: Schema.Types.ObjectId, required: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, trim: true, maxlength: 2000 },
    startDate: { type: Date, required: true },
    endDate: { type: Date, default: null },
    allDay: { type: Boolean, default: false },
    source: { type: String, required: true, trim: true, maxlength: 60 },
    createdByUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  { timestamps: true, collection: 'pm_calendar_events' },
);

CalendarEventSchema.index({ organizationId: 1, startDate: -1 });
CalendarEventSchema.index({ organizationId: 1, parentType: 1, parentId: 1 });

export const CalendarEvent: Model<ICalendarEvent> =
  (models.PmCalendarEvent as Model<ICalendarEvent>) ??
  model<ICalendarEvent>('PmCalendarEvent', CalendarEventSchema);

export default CalendarEvent;
