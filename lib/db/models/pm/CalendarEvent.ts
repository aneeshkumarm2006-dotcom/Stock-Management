// CalendarEvent — Phase 7 full surface (PDR_MASTER §3.34, BR-CC-6..11).
//
// History: Phase 4 shipped a minimal stub so BR-MV-7's "Create work order
// and schedule event" had a real persisted row to write against. Phase 7
// fills the surface — propertyId scoping (BR-CC-6), org timezone snapshot
// (BR-CC-9), Resident Center auto-publish (BR-CC-10), reminder dispatch,
// recurrence with instance-vs-series edit semantics ([G-B-13]), ICS export,
// and the calendar grid at /properties/calendars.
//
// `title` is preserved as a denormalized mirror of `eventName` so any
// Phase 4 rows already on disk keep round-tripping through GET (the
// pre-save hook keeps them in sync going forward; no data migration
// required).
import { Schema, model, models, Types, type Model } from 'mongoose';
import { PARENT_TYPES } from '@/lib/pm/parentTypes';
import type {
  ParentType,
  CalendarRepeat,
  CalendarReminder,
} from '@/types/pm';
import { CALENDAR_REPEATS, CALENDAR_REMINDERS } from '@/types/pm';
import { WarningSchema, type IWarning } from './_shared/WarningSchema';

export interface ICalendarEvent {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  /** Single-property scope at creation (BR-CC-6). */
  propertyId: Types.ObjectId;
  /** Polymorphic parent — defaults to self for grid-created events; set
   *  to 'WorkOrder' for BR-MV-7 schedule-event flow. */
  parentType: ParentType;
  parentId: Types.ObjectId;
  /** Canonical display name. Mirrored into `title` by the pre-save hook
   *  so Phase 4 readers that select `title` still resolve. */
  eventName: string;
  title: string;
  description?: string;
  startDate: Date;
  endDate: Date;
  allDay: boolean;
  /** Read-only on input; snapshot from Organization.timezone (BR-CC-9). */
  timezone: string;
  repeat: CalendarRepeat;
  /** Stored RRULE text for repeat='Custom'; otherwise derived. */
  recurrenceRule?: string;
  /** Set when this row is a detached instance of a recurring master
   *  (DECISIONS [G-B-13]); otherwise null. */
  recurrenceParentId?: Types.ObjectId | null;
  /** Exclusion list on a master row — entries are the original start
   *  dates of detached or cancelled occurrences. */
  recurrenceExclusions?: Date[];
  location?: string;
  reminder: CalendarReminder;
  /** Stamped by the dispatcher sweep so we don't double-fire. */
  reminderSentAt?: Date | null;
  /** Back-pointer when created via BR-MV-7. */
  linkedWorkOrderId?: Types.ObjectId | null;
  /** PmFile ids attached to the event ([G-B-16]). */
  attachments?: Types.ObjectId[];
  /** Originating surface — e.g. 'Calendars', 'WorkOrder'. */
  source: string;
  createdByUserId: Types.ObjectId;
  warnings: IWarning[];
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
    propertyId: {
      type: Schema.Types.ObjectId,
      ref: 'PmProperty',
      default: null,
    },
    parentType: {
      type: String,
      enum: PARENT_TYPES,
      required: true,
    },
    parentId: { type: Schema.Types.ObjectId, required: true },
    eventName: { type: String, default: '', trim: true, maxlength: 200 },
    title: { type: String, default: '', trim: true, maxlength: 200 },
    description: { type: String, trim: true, maxlength: 2000 },
    startDate: { type: Date, default: null },
    endDate: { type: Date, default: null },
    allDay: { type: Boolean, default: false },
    timezone: { type: String, required: true, trim: true },
    repeat: {
      type: String,
      enum: CALENDAR_REPEATS,
      default: 'Does not repeat',
      required: true,
    },
    recurrenceRule: { type: String, default: '', maxlength: 500 },
    recurrenceParentId: {
      type: Schema.Types.ObjectId,
      ref: 'PmCalendarEvent',
      default: null,
    },
    recurrenceExclusions: { type: [Date], default: [] },
    location: { type: String, trim: true, maxlength: 200 },
    reminder: {
      type: String,
      enum: CALENDAR_REMINDERS,
      default: 'None',
      required: true,
    },
    reminderSentAt: { type: Date, default: null },
    linkedWorkOrderId: {
      type: Schema.Types.ObjectId,
      ref: 'PmWorkOrder',
      default: null,
    },
    attachments: {
      type: [{ type: Schema.Types.ObjectId, ref: 'PmFile' }],
      default: [],
    },
    source: { type: String, required: true, trim: true, maxlength: 60 },
    createdByUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    warnings: { type: [WarningSchema], default: [] },
  },
  { timestamps: true, collection: 'pm_calendar_events' },
);

// `title` mirror stays in sync with `eventName` so Phase 4 readers that
// selected `title` still resolve. The end >= start check that used to live
// here is now a non-blocking warning (CALENDAR_END_BEFORE_START in
// lib/pm/warnings.ts); the row still saves either way.
CalendarEventSchema.pre('validate', function (next) {
  const doc = this as unknown as ICalendarEvent & {
    isModified: (path: string) => boolean;
  };
  if (!doc.endDate && doc.startDate) {
    doc.endDate = new Date(doc.startDate.getTime() + 60 * 60 * 1000);
  }
  if (doc.isModified('eventName') && doc.eventName) {
    doc.title = doc.eventName;
  } else if (!doc.title && doc.eventName) {
    doc.title = doc.eventName;
  }
  next();
});

CalendarEventSchema.index({ organizationId: 1, startDate: -1 });
CalendarEventSchema.index({ organizationId: 1, propertyId: 1, startDate: 1 });
CalendarEventSchema.index({ organizationId: 1, parentType: 1, parentId: 1 });
CalendarEventSchema.index({
  organizationId: 1,
  reminder: 1,
  reminderSentAt: 1,
  startDate: 1,
});

export const CalendarEvent: Model<ICalendarEvent> =
  (models.PmCalendarEvent as Model<ICalendarEvent>) ??
  model<ICalendarEvent>('PmCalendarEvent', CalendarEventSchema);

export default CalendarEvent;
