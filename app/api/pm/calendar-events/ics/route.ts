// ICS export for the calendar grid ([G-B-15]).
//
// Returns an RFC 5545 VCALENDAR containing every master event in the
// org (optionally filtered by ?propertyIds=). Subscribing to this URL
// from Google Calendar / Outlook / Apple Calendar yields a synced
// one-way feed; the master row's RRULE drives client-side expansion.
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { CalendarEvent } from '@/lib/db/models/pm/CalendarEvent';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { buildIcs } from '@/lib/pm/calendarEvents';
import { CALENDAR_MAX_OVERLAYS } from '@/types/pm';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();

  const url = new URL(request.url);
  const propertyIdsParam = url.searchParams.get('propertyIds');
  await connectToDatabase();

  const query: Record<string, unknown> = {
    organizationId: new Types.ObjectId(ctx.orgId),
  };
  if (propertyIdsParam) {
    const ids = propertyIdsParam
      .split(',')
      .map((s) => s.trim())
      .filter((s) => Types.ObjectId.isValid(s));
    if (ids.length > CALENDAR_MAX_OVERLAYS) {
      return NextResponse.json(
        { error: `Maximum ${CALENDAR_MAX_OVERLAYS} property overlays (BR-CC-7)` },
        { status: 400 },
      );
    }
    if (ids.length > 0) {
      query.propertyId = { $in: ids.map((id) => new Types.ObjectId(id)) };
    }
  }

  const docs = await CalendarEvent.find(query).sort({ startDate: 1 }).lean();
  const ics = buildIcs(docs as never, 'Stock Portfolio PM Calendar');

  return new NextResponse(ics, {
    status: 200,
    headers: {
      'content-type': 'text/calendar; charset=utf-8',
      'content-disposition': 'attachment; filename="calendar.ics"',
    },
  });
}
