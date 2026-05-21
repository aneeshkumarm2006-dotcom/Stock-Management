// Organization read/update. GET returns the current PM org for the session;
// PATCH updates org-level settings (timezone, fiscal year, accounting mode,
// sender mailbox). Admin-only on writes.
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { Organization } from '@/lib/db/models/pm/Organization';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { canManageOrg } from '@/lib/pm/roles';
import { logActivity } from '@/lib/pm/activity';
import { organizationUpdateSchema } from '@/lib/validation/pm/organization';

export const runtime = 'nodejs';

function serialize(doc: Record<string, unknown>) {
  const senderMailbox = doc.senderMailbox as
    | {
        defaultFrom?: string;
        perPropertyOverrides?: Map<string, string> | Record<string, string>;
      }
    | undefined;

  const overrides =
    senderMailbox?.perPropertyOverrides instanceof Map
      ? Object.fromEntries(senderMailbox.perPropertyOverrides)
      : (senderMailbox?.perPropertyOverrides as Record<string, string>) ?? {};

  return {
    id: String(doc._id),
    name: doc.name,
    slug: doc.slug,
    timezone: doc.timezone,
    fiscalYearStart: doc.fiscalYearStart,
    accountingMode: doc.accountingMode,
    defaultCurrency: doc.defaultCurrency,
    senderMailbox: {
      defaultFrom: senderMailbox?.defaultFrom ?? null,
      perPropertyOverrides: overrides,
    },
    trialEndsAt: doc.trialEndsAt,
    subscriptionStatus: doc.subscriptionStatus,
    active: doc.active,
  };
}

export async function GET() {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();

  await connectToDatabase();
  const org = await Organization.findById(new Types.ObjectId(ctx.orgId)).lean();
  if (!org) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json(serialize(org));
}

export async function PATCH(request: Request) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();
  if (!canManageOrg(ctx)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = organizationUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  await connectToDatabase();
  const orgObjectId = new Types.ObjectId(ctx.orgId);

  const update: Record<string, unknown> = { ...parsed.data };
  // Map nested senderMailbox.perPropertyOverrides to a Mongo Map shape.
  if (parsed.data.senderMailbox?.perPropertyOverrides) {
    update.senderMailbox = {
      defaultFrom: parsed.data.senderMailbox.defaultFrom,
      perPropertyOverrides: new Map(
        Object.entries(parsed.data.senderMailbox.perPropertyOverrides),
      ),
    };
  }

  const doc = await Organization.findByIdAndUpdate(
    orgObjectId,
    { $set: update },
    { new: true },
  ).lean();
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  await logActivity({
    orgId: ctx.orgId,
    parentType: 'Task',
    parentId: orgObjectId,
    eventType: 'Organization updated',
    actorUserId: ctx.userId,
    payload: { fields: Object.keys(parsed.data) },
  });

  return NextResponse.json(serialize(doc));
}
