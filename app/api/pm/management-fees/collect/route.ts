// POST /api/pm/management-fees/collect — BR-AC-16. Triggers the
// `collectManagementFees` helper for the given window. Body:
//   { periodStart, periodEnd, propertyIds? }
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Types } from 'mongoose';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { collectManagementFees } from '@/lib/pm/managementFees';
import { logActivity } from '@/lib/pm/activity';

export const runtime = 'nodejs';

const objectIdString = z
  .string()
  .refine((v) => Types.ObjectId.isValid(v), { message: 'Invalid id' });

const collectSchema = z.object({
  periodStart: z.string().min(8),
  periodEnd: z.string().min(8),
  propertyIds: z.array(objectIdString).optional(),
});

export async function POST(request: Request) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const parsed = collectSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const start = new Date(parsed.data.periodStart);
  const end = new Date(parsed.data.periodEnd);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return NextResponse.json({ error: 'Invalid period dates' }, { status: 400 });
  }
  if (start > end) {
    return NextResponse.json(
      { error: 'periodStart must be on or before periodEnd' },
      { status: 400 },
    );
  }

  try {
    const result = await collectManagementFees({
      orgId: ctx.orgId,
      ctx,
      periodStart: start,
      periodEnd: end,
      propertyIds: parsed.data.propertyIds,
    });

    await logActivity({
      orgId: ctx.orgId,
      parentType: 'CompanyAccount',
      parentId: null as unknown as Types.ObjectId,
      eventType: 'Management fees collected',
      actorUserId: ctx.userId,
      payload: {
        postedCount: result.posted.length,
        skippedCount: result.skipped.length,
        totalFeeCents: result.posted.reduce((s, p) => s + p.feeCents, 0),
      },
    });

    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to collect fees';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
