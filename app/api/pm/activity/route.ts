// Activity feed (PDR_MASTER §3.38). Read-only — entries are written
// system-side via `logActivity()` from every mutating PM route.
// Filter modes:
//   ?parentType=X&parentId=Y   — Event-history tab for one entity
//   (no filter)                — Org-wide recent activity (Dashboard)
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { ActivityLogEntry } from '@/lib/db/models/pm/ActivityLogEntry';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { isParentType } from '@/lib/pm/parentTypes';

export const runtime = 'nodejs';

function serialize(d: Record<string, unknown>) {
  return {
    id: String(d._id),
    parentType: d.parentType,
    parentId: String(d.parentId),
    eventType: d.eventType,
    actorUserId: String(d.actorUserId),
    payload: d.payload ?? null,
    createdAt: d.createdAt,
  };
}

export async function GET(request: Request) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();

  const { searchParams } = new URL(request.url);
  const parentType = searchParams.get('parentType');
  const parentId = searchParams.get('parentId');
  const limit = Math.min(
    Math.max(parseInt(searchParams.get('limit') ?? '50', 10) || 50, 1),
    200,
  );

  await connectToDatabase();
  const filter: Record<string, unknown> = {
    organizationId: new Types.ObjectId(ctx.orgId),
  };
  if (parentType && parentId) {
    if (!isParentType(parentType)) {
      return NextResponse.json({ error: 'Invalid parentType' }, { status: 400 });
    }
    if (!Types.ObjectId.isValid(parentId)) {
      return NextResponse.json({ error: 'Invalid parentId' }, { status: 400 });
    }
    filter.parentType = parentType;
    filter.parentId = new Types.ObjectId(parentId);
  }

  const rows = await ActivityLogEntry.find(filter)
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  return NextResponse.json(rows.map(serialize));
}
