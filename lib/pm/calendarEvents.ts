// CalendarEvent helpers (Phase 7).
//
// Three concerns live here:
//   1. Recurrence expansion — given a master row + a window, emit virtual
//      occurrences. Phase 7 supports the five named cadences from
//      `CALENDAR_REPEATS`; `Custom` falls through to the master only
//      (full RRULE parsing is deferred to Phase 7.1).
//   2. ICS export — serialize one event (or a list of master rows + their
//      occurrences) into RFC 5545 text for [G-B-15].
//   3. Reminder dispatch — sweep upcoming events whose start −
//      lead-time has elapsed but `reminderSentAt` is still null; write a
//      Notification per active Tenant on the Property and stamp the row.
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { CalendarEvent, type ICalendarEvent } from '@/lib/db/models/pm/CalendarEvent';
import { Lease } from '@/lib/db/models/pm/Lease';
import { Tenant } from '@/lib/db/models/pm/Tenant';
import { Notification } from '@/lib/db/models/pm/Notification';
import {
  CALENDAR_REMINDER_LEAD_MS,
  type CalendarRepeat,
} from '@/types/pm';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ExpandedOccurrence {
  /** Master row id. For virtual occurrences this is the parent. */
  masterId: string;
  /** Stable composite id for the front end: masterId@startMs */
  occurrenceId: string;
  startDate: Date;
  endDate: Date;
  /** True when this row IS the master (no virtualization). */
  isMaster: boolean;
}

/** Given a master event + a date window, yield concrete occurrences. */
export function expandRecurrence(
  master: Pick<
    ICalendarEvent,
    'startDate' | 'endDate' | 'repeat' | 'recurrenceExclusions' | '_id'
  >,
  windowStart: Date,
  windowEnd: Date,
): ExpandedOccurrence[] {
  const out: ExpandedOccurrence[] = [];
  const startMs = master.startDate.getTime();
  const endMs = master.endDate.getTime();
  const duration = endMs - startMs;
  const excluded = new Set(
    (master.recurrenceExclusions ?? []).map((d) => new Date(d).getTime()),
  );

  function push(occStart: Date, isMaster: boolean) {
    if (excluded.has(occStart.getTime())) return;
    if (occStart.getTime() > windowEnd.getTime()) return;
    const occEnd = new Date(occStart.getTime() + duration);
    if (occEnd.getTime() < windowStart.getTime()) return;
    out.push({
      masterId: String(master._id),
      occurrenceId: `${String(master._id)}@${occStart.getTime()}`,
      startDate: occStart,
      endDate: occEnd,
      isMaster,
    });
  }

  const repeat = master.repeat as CalendarRepeat;
  if (repeat === 'Does not repeat' || repeat === 'Custom') {
    push(master.startDate, true);
    return out;
  }

  // Walk forward from the master start until we pass windowEnd. Cap at
  // 366 iterations as a defense in depth so a malformed daily series
  // can't run away. The grid never asks for more than ~62 days.
  const cap = 366;
  for (let i = 0; i < cap; i += 1) {
    const next = stepForward(master.startDate, repeat, i);
    if (next.getTime() > windowEnd.getTime()) break;
    push(next, i === 0);
  }
  return out;
}

function stepForward(start: Date, repeat: CalendarRepeat, n: number): Date {
  const d = new Date(start);
  switch (repeat) {
    case 'Daily':
      d.setTime(start.getTime() + n * DAY_MS);
      return d;
    case 'Weekly':
      d.setTime(start.getTime() + n * 7 * DAY_MS);
      return d;
    case 'Monthly':
      d.setMonth(start.getMonth() + n);
      return d;
    case 'Annually':
      d.setFullYear(start.getFullYear() + n);
      return d;
    default:
      return d;
  }
}

// ---------------------------------------------------------------------------
// ICS export ([G-B-15])
// ---------------------------------------------------------------------------

function icsEscape(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

function icsDate(d: Date, allDay: boolean): string {
  if (allDay) {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}${m}${day}`;
  }
  return d.toISOString().replace(/[-:]|\.\d{3}/g, '');
}

const REPEAT_TO_RRULE: Record<CalendarRepeat, string | null> = {
  'Does not repeat': null,
  Daily: 'FREQ=DAILY',
  Weekly: 'FREQ=WEEKLY',
  Monthly: 'FREQ=MONTHLY',
  Annually: 'FREQ=YEARLY',
  Custom: null,
};

/** Build one VEVENT block for a single master row. */
function buildVEvent(ev: ICalendarEvent): string[] {
  const lines: string[] = [];
  lines.push('BEGIN:VEVENT');
  lines.push(`UID:${String(ev._id)}@stockportfolio.pm`);
  lines.push(`DTSTAMP:${icsDate(new Date(), false)}`);
  lines.push(
    `DTSTART${ev.allDay ? ';VALUE=DATE' : ''}:${icsDate(ev.startDate, ev.allDay)}`,
  );
  lines.push(
    `DTEND${ev.allDay ? ';VALUE=DATE' : ''}:${icsDate(ev.endDate, ev.allDay)}`,
  );
  lines.push(`SUMMARY:${icsEscape(ev.eventName)}`);
  if (ev.description) {
    lines.push(`DESCRIPTION:${icsEscape(ev.description)}`);
  }
  if (ev.location) {
    lines.push(`LOCATION:${icsEscape(ev.location)}`);
  }
  const rrule = REPEAT_TO_RRULE[ev.repeat as CalendarRepeat];
  if (rrule) lines.push(`RRULE:${rrule}`);
  else if (ev.repeat === 'Custom' && ev.recurrenceRule) {
    lines.push(`RRULE:${ev.recurrenceRule}`);
  }
  if (ev.recurrenceExclusions && ev.recurrenceExclusions.length > 0) {
    for (const ex of ev.recurrenceExclusions) {
      lines.push(`EXDATE:${icsDate(ex, ev.allDay)}`);
    }
  }
  lines.push('END:VEVENT');
  return lines;
}

export function buildIcs(events: ICalendarEvent[], calName = 'Calendar'): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Stock Portfolio PM//Calendar//EN',
    'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:${icsEscape(calName)}`,
  ];
  for (const ev of events) {
    lines.push(...buildVEvent(ev));
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

// ---------------------------------------------------------------------------
// Audience resolution (BR-CC-8) — `All tenants` on a Property at publish.
// ---------------------------------------------------------------------------

export interface ActiveTenantTouch {
  tenantId: Types.ObjectId;
  email?: string;
  firstName?: string;
  lastName?: string;
}

export async function resolveActiveTenantsOnProperty(
  orgId: Types.ObjectId,
  propertyId: Types.ObjectId,
): Promise<ActiveTenantTouch[]> {
  await connectToDatabase();
  const leases = await Lease.find({
    organizationId: orgId,
    propertyId,
    status: { $in: ['Active', 'Future'] },
  })
    .select('tenants')
    .lean();
  const ids = new Set<string>();
  for (const lease of leases) {
    for (const t of (lease.tenants ?? []) as Array<{
      tenantId: Types.ObjectId;
    }>) {
      if (t.tenantId) ids.add(String(t.tenantId));
    }
  }
  if (ids.size === 0) return [];
  const tenants = await Tenant.find({
    organizationId: orgId,
    _id: { $in: Array.from(ids).map((id) => new Types.ObjectId(id)) },
    active: true,
  })
    .select('_id email firstName lastName')
    .lean();
  return tenants.map((t) => ({
    tenantId: t._id,
    email: t.email,
    firstName: t.firstName,
    lastName: t.lastName,
  }));
}

// ---------------------------------------------------------------------------
// Reminder dispatch sweep (Phase 6 + Phase 7).
//
// Fires once per event when `now >= startDate − lead`. Writes one
// Notification per active Tenant on the Property and stamps the row's
// `reminderSentAt` so the next sweep skips it.
// ---------------------------------------------------------------------------

export interface ReminderDispatchResult {
  scanned: number;
  remindersSent: number;
  eventIds: string[];
}

export async function dispatchCalendarReminders(
  now: Date = new Date(),
): Promise<ReminderDispatchResult> {
  await connectToDatabase();
  const due = await CalendarEvent.find({
    reminder: { $ne: 'None' },
    reminderSentAt: null,
    startDate: { $gt: now },
  })
    .select(
      '_id organizationId propertyId eventName startDate reminder reminderSentAt',
    )
    .lean<
      Array<{
        _id: Types.ObjectId;
        organizationId: Types.ObjectId;
        propertyId: Types.ObjectId;
        eventName: string;
        startDate: Date;
        reminder: keyof typeof CALENDAR_REMINDER_LEAD_MS;
      }>
    >();

  let sent = 0;
  const fired: string[] = [];
  for (const ev of due) {
    const lead = CALENDAR_REMINDER_LEAD_MS[ev.reminder];
    if (lead < 0) continue;
    const fireAt = new Date(ev.startDate.getTime() - lead);
    if (now.getTime() < fireAt.getTime()) continue;

    const tenants = await resolveActiveTenantsOnProperty(
      ev.organizationId,
      ev.propertyId,
    );
    if (tenants.length > 0) {
      await Notification.insertMany(
        tenants.map((t) => ({
          organizationId: ev.organizationId,
          recipientUserId: t.tenantId,
          kind: 'info',
          title: `Upcoming: ${ev.eventName}`,
          body: `Starts ${ev.startDate.toISOString()}`,
          link: `/properties/calendars?event=${String(ev._id)}`,
        })),
        { ordered: false },
      ).catch((err) => {
        console.error('dispatchCalendarReminders insertMany failed', err);
      });
      sent += tenants.length;
    }
    await CalendarEvent.updateOne(
      { _id: ev._id },
      { $set: { reminderSentAt: now } },
    );
    fired.push(String(ev._id));
  }
  return { scanned: due.length, remindersSent: sent, eventIds: fired };
}
