// CalendarEvent Zod validators (PDR_MASTER §3.34, Phase 7).
//
// `eventName` gates Create (BR-CC-?); propertyId is required at create
// per BR-CC-6 (single-property scope). `timezone` is derived from the
// org and is NOT accepted on input (BR-CC-9). `invitees` is fixed to
// `All tenants` and is not user-writable (BR-CC-8).
import { z } from 'zod';
import {
  CALENDAR_REPEATS,
  CALENDAR_REMINDERS,
  CALENDAR_EDIT_SCOPES,
} from '@/types/pm';

const objectIdSchema = z
  .string()
  .regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');

const datetimeOrDate = z.string().datetime().or(z.string().date());

export const calendarEventCreateSchema = z
  .object({
    propertyId: objectIdSchema,
    eventName: z.string().trim().min(1, 'Event name is required').max(200),
    description: z.string().trim().max(2000).optional(),
    startDate: datetimeOrDate,
    endDate: datetimeOrDate.nullable().optional(),
    allDay: z.boolean().optional().default(false),
    repeat: z
      .enum(CALENDAR_REPEATS as readonly [string, ...string[]])
      .optional()
      .default('Does not repeat'),
    recurrenceRule: z.string().trim().max(500).optional(),
    location: z.string().trim().max(200).optional(),
    reminder: z
      .enum(CALENDAR_REMINDERS as readonly [string, ...string[]])
      .optional()
      .default('None'),
    linkedWorkOrderId: objectIdSchema.nullable().optional(),
    attachments: z.array(objectIdSchema).optional(),
    /** Server-stamped from session if absent. Used by the WorkOrder
     *  schedule-event sub-route to mark provenance. */
    source: z.string().trim().min(1).max(60).optional(),
    /** Polymorphic activity-log parent override. When absent, the route
     *  stamps `parentType=CalendarEvent` + `parentId=self`. */
    parentType: z.string().trim().min(1).max(40).optional(),
    parentId: objectIdSchema.optional(),
  })
  .refine(
    (d) => {
      // End ≥ Start (BR-CC-11) — Mongoose pre-save also enforces, but
      // checking at the edge gives a clean 400.
      if (!d.endDate) return true;
      return new Date(d.endDate).getTime() >= new Date(d.startDate).getTime();
    },
    { message: 'endDate must be ≥ startDate', path: ['endDate'] },
  );

export const calendarEventUpdateSchema = z
  .object({
    eventName: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    startDate: datetimeOrDate.optional(),
    endDate: datetimeOrDate.nullable().optional(),
    allDay: z.boolean().optional(),
    repeat: z
      .enum(CALENDAR_REPEATS as readonly [string, ...string[]])
      .optional(),
    recurrenceRule: z.string().trim().max(500).optional(),
    location: z.string().trim().max(200).nullable().optional(),
    reminder: z
      .enum(CALENDAR_REMINDERS as readonly [string, ...string[]])
      .optional(),
    attachments: z.array(objectIdSchema).optional(),
    /** When the row has a recurrenceParentId, the client must declare
     *  whether the edit applies to this instance only or the whole
     *  series (DECISIONS [G-B-13]). Ignored on non-recurring rows. */
    editScope: z
      .enum(CALENDAR_EDIT_SCOPES as readonly [string, ...string[]])
      .optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: 'No fields to update',
  });

export const calendarEventDeleteQuerySchema = z.object({
  editScope: z
    .enum(CALENDAR_EDIT_SCOPES as readonly [string, ...string[]])
    .optional(),
});

export const calendarEventListQuerySchema = z.object({
  from: datetimeOrDate.optional(),
  to: datetimeOrDate.optional(),
  /** Comma-separated property ids to overlay (BR-CC-7 max 15). */
  propertyIds: z.string().optional(),
});

export type CalendarEventCreate = z.infer<typeof calendarEventCreateSchema>;
export type CalendarEventUpdate = z.infer<typeof calendarEventUpdateSchema>;
