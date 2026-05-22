// LockedPeriodPolicy admin CRUD (PDR §3.27, BR-AC-3).
// Gated to Admin via canManageOrg(). FinancialAdministrator can OVERRIDE locks
// at write-time but does not manage policies — keeps roles separate.
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { LockedPeriodPolicy } from '@/lib/db/models/pm/LockedPeriodPolicy';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { lockedPeriodCreateSchema } from '@/lib/validation/pm/lockedPeriodPolicy';
import { logActivity } from '@/lib/pm/activity';
import { canManageOrg } from '@/lib/pm/roles';
import { serializeLockedPeriod } from './serialize';

export const runtime = 'nodejs';

export async function GET() {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();

  await connectToDatabase();
  const rows = await LockedPeriodPolicy.find({
    organizationId: new Types.ObjectId(ctx.orgId),
  })
    .sort({ active: -1, createdAt: -1 })
    .lean();
  return NextResponse.json(rows.map((r) => serializeLockedPeriod(r as Record<string, unknown>)));
}

export async function POST(request: Request) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();
  if (!canManageOrg(ctx)) {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = lockedPeriodCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  await connectToDatabase();
  try {
    const doc = await LockedPeriodPolicy.create({
      organizationId: new Types.ObjectId(ctx.orgId),
      scope: parsed.data.scope,
      propertyId: parsed.data.propertyId
        ? new Types.ObjectId(parsed.data.propertyId)
        : null,
      fromDate: parsed.data.fromDate ? new Date(parsed.data.fromDate) : null,
      toDate: parsed.data.toDate ? new Date(parsed.data.toDate) : null,
      message: parsed.data.message,
      active: parsed.data.active ?? true,
      createdByUserId: new Types.ObjectId(ctx.userId),
    });

    await logActivity({
      orgId: ctx.orgId,
      parentType: 'LockedPeriodPolicy',
      parentId: doc._id,
      eventType: 'Locked period policy created',
      actorUserId: ctx.userId,
      payload: {
        scope: doc.scope,
        propertyId: doc.propertyId ? String(doc.propertyId) : null,
      },
    });

    return NextResponse.json(
      serializeLockedPeriod(doc.toObject() as unknown as Record<string, unknown>),
      { status: 201 },
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to save locked period policy';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
