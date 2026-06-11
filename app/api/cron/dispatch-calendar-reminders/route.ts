// Cron entry — sweeps CalendarEvents whose reminder lead-time has
// elapsed and dispatches one Notification per active Tenant on the
// Property (BR-CC-8). Phase 7 wires this so the reminder UX is
// usable end-to-end; the Communications email channel (Phase 6) is
// the future home for the email half of the fan-out.
//
// Auth mirrors the post-recurring-tasks route — Bearer CRON_SECRET.
import { NextResponse } from 'next/server';
import { dispatchCalendarReminders } from '@/lib/pm/calendarEvents';

export const runtime = 'nodejs';

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== 'production'; // fail-closed in prod
  return request.headers.get('authorization') === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const result = await dispatchCalendarReminders();
  return NextResponse.json(result);
}

export const POST = GET;
