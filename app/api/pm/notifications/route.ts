// Notification queue — feeds the header bell badge. Phase 0 ships the read
// path only; Phase 1+ writers populate the queue.
// GET /api/pm/notifications        → { unreadCount, items: [latest 20] }
// PATCH /api/pm/notifications      → { ids: [...] } marks-as-read
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { z } from 'zod';
import { connectToDatabase } from '@/lib/db/mongoose';
import { Notification } from '@/lib/db/models/pm/Notification';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';

export const runtime = 'nodejs';

const markReadSchema = z.object({
  ids: z.array(z.string().min(1)).min(1),
});

function serialize(d: Record<string, unknown>) {
  return {
    id: String(d._id),
    kind: d.kind,
    title: d.title,
    body: d.body ?? null,
    link: d.link ?? null,
    readAt: d.readAt ?? null,
    createdAt: d.createdAt,
  };
}

export async function GET() {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();

  await connectToDatabase();
  const orgObjectId = new Types.ObjectId(ctx.orgId);
  const userObjectId = new Types.ObjectId(ctx.userId);

  const [items, unreadCount] = await Promise.all([
    Notification.find({
      organizationId: orgObjectId,
      recipientUserId: userObjectId,
    })
      .sort({ createdAt: -1 })
      .limit(20)
      .lean(),
    Notification.countDocuments({
      organizationId: orgObjectId,
      recipientUserId: userObjectId,
      readAt: null,
    }),
  ]);

  return NextResponse.json({
    unreadCount,
    items: items.map(serialize),
  });
}

export async function PATCH(request: Request) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = markReadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  await connectToDatabase();
  const valid = parsed.data.ids.filter((id) => Types.ObjectId.isValid(id));
  if (valid.length === 0) {
    return NextResponse.json({ ok: true, modified: 0 });
  }

  const result = await Notification.updateMany(
    {
      _id: { $in: valid.map((id) => new Types.ObjectId(id)) },
      organizationId: new Types.ObjectId(ctx.orgId),
      recipientUserId: new Types.ObjectId(ctx.userId),
      readAt: null,
    },
    { $set: { readAt: new Date() } },
  );

  return NextResponse.json({ ok: true, modified: result.modifiedCount });
}
