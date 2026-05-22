// Prospect CRUD (PDR §3.9). Lightweight CRM funnel record; conversion to
// Applicant is a one-way step in the `/[id]/convert-to-applicant` route.
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { Prospect } from '@/lib/db/models/pm/Prospect';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { prospectCreateSchema } from '@/lib/validation/pm/prospect';
import { logActivity } from '@/lib/pm/activity';
import { PROSPECT_STATUSES } from '@/types/pm';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status');
  const q = searchParams.get('q')?.trim();

  await connectToDatabase();
  const filter: Record<string, unknown> = {
    organizationId: new Types.ObjectId(ctx.orgId),
  };
  if (status && (PROSPECT_STATUSES as readonly string[]).includes(status)) {
    filter.status = status;
  }
  if (q) {
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [
      { firstName: rx },
      { lastName: rx },
      { email: rx },
      { phone: rx },
    ];
  }

  const rows = await Prospect.find(filter)
    .sort({ updatedAt: -1 })
    .lean();

  return NextResponse.json(
    rows.map((r) => ({
      id: String(r._id),
      firstName: r.firstName,
      lastName: r.lastName,
      displayName: `${r.firstName} ${r.lastName}`.trim(),
      email: r.email ?? '',
      phone: r.phone ?? '',
      status: r.status,
      propertyId: r.propertyId ? String(r.propertyId) : null,
      movingDate: r.movingDate ?? null,
      beds: r.beds ?? null,
      convertedToApplicantId: r.convertedToApplicantId
        ? String(r.convertedToApplicantId)
        : null,
      convertedAt: r.convertedAt ?? null,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    })),
  );
}

export async function POST(request: Request) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = prospectCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  await connectToDatabase();
  const doc = await Prospect.create({
    organizationId: new Types.ObjectId(ctx.orgId),
    firstName: parsed.data.firstName,
    lastName: parsed.data.lastName,
    email: parsed.data.email,
    phone: parsed.data.phone,
    status: parsed.data.status ?? 'New',
    propertyId: parsed.data.propertyId
      ? new Types.ObjectId(parsed.data.propertyId)
      : null,
    movingDate: parsed.data.movingDate
      ? new Date(parsed.data.movingDate)
      : null,
    beds: parsed.data.beds ?? null,
    notes: parsed.data.notes,
    customFields: parsed.data.customFields ?? {},
  });

  await logActivity({
    orgId: ctx.orgId,
    parentType: 'Prospect',
    parentId: doc._id,
    eventType: 'Prospect created',
    actorUserId: ctx.userId,
    payload: {
      name: `${doc.firstName} ${doc.lastName}`.trim(),
    },
  });

  return NextResponse.json({ id: String(doc._id) }, { status: 201 });
}
