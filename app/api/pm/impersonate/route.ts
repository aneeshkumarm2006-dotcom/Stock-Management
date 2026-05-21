// Sign-in-as-user (DECISIONS.md [G-B-6]). Admin-only.
// POST { targetUserId } → returns the new session payload (the client should
// call `useSession().update({ impersonatedBy, effectiveUserId })` to flip the
// JWT — this route just authorises the swap and reports what to set).
// DELETE → instructs the client to clear impersonation.
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { z } from 'zod';
import { connectToDatabase } from '@/lib/db/mongoose';
import { User } from '@/lib/db/models/User';
import { OrgMembership } from '@/lib/db/models/pm/OrgMembership';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { canImpersonate } from '@/lib/pm/roles';
import { logActivity } from '@/lib/pm/activity';

export const runtime = 'nodejs';

const startSchema = z.object({
  targetUserId: z.string().min(1),
});

export async function POST(request: Request) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();
  if (!canImpersonate(ctx)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = startSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  if (parsed.data.targetUserId === ctx.userId) {
    return NextResponse.json(
      { error: 'Cannot impersonate yourself' },
      { status: 400 },
    );
  }

  await connectToDatabase();

  // Target must exist and be a member of the same org.
  const targetExists = await User.exists({
    _id: new Types.ObjectId(parsed.data.targetUserId),
  });
  if (!targetExists) {
    return NextResponse.json(
      { error: 'Target user not found' },
      { status: 404 },
    );
  }
  const member = await OrgMembership.exists({
    organizationId: new Types.ObjectId(ctx.orgId),
    userId: new Types.ObjectId(parsed.data.targetUserId),
    active: true,
  });
  if (!member) {
    return NextResponse.json(
      { error: 'Target is not a member of your organization' },
      { status: 404 },
    );
  }

  // Audit — record the impersonation start against the admin's own user id
  // as a Task-typed event (placeholder parentType; Phase 1+ may introduce a
  // dedicated security log).
  await logActivity({
    orgId: ctx.orgId,
    parentType: 'Task',
    parentId: new Types.ObjectId(),
    eventType: 'Impersonation started',
    actorUserId: ctx.userId,
    payload: { targetUserId: parsed.data.targetUserId },
  });

  return NextResponse.json({
    update: {
      impersonatedBy: ctx.userId,
      effectiveUserId: parsed.data.targetUserId,
    },
  });
}

export async function DELETE() {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();
  if (!ctx.impersonatedBy) {
    return NextResponse.json({ error: 'Not impersonating' }, { status: 400 });
  }

  await logActivity({
    orgId: ctx.orgId,
    parentType: 'Task',
    parentId: new Types.ObjectId(),
    eventType: 'Impersonation stopped',
    actorUserId: ctx.impersonatedBy,
    payload: { impersonatedUserId: ctx.userId },
  });

  return NextResponse.json({
    update: { impersonatedBy: null },
  });
}
