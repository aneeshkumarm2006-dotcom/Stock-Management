// Generic warning-dismiss endpoint. One file handles all 11 warningable
// entities — adding a new one is a registry entry, not a new route.
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { z } from 'zod';
import { connectToDatabase } from '@/lib/db/mongoose';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { WARNING_ENTITY_MODELS } from '@/lib/pm/warningEntityRegistry';
import { WARNINGABLE_TYPES } from '@/lib/pm/warnings';

export const runtime = 'nodejs';

const bodySchema = z.object({
  entityType: z.enum(WARNINGABLE_TYPES as [string, ...string[]]),
  entityId: z.string().refine((v) => Types.ObjectId.isValid(v), 'Invalid entityId'),
  code: z.string().min(1).max(64),
});

export async function PATCH(request: Request) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const { entityType, entityId, code } = parsed.data;
  const Model = WARNING_ENTITY_MODELS[entityType as keyof typeof WARNING_ENTITY_MODELS];
  if (!Model) {
    return NextResponse.json({ error: 'Unknown entityType' }, { status: 400 });
  }

  await connectToDatabase();

  // Find by org so users can't dismiss warnings on other orgs' docs.
  const res = await Model.updateOne(
    {
      _id: new Types.ObjectId(entityId),
      organizationId: new Types.ObjectId(ctx.orgId),
      'warnings.code': code,
    },
    {
      $set: { 'warnings.$.dismissedAt': new Date() },
    },
  );

  if (res.matchedCount === 0) {
    return NextResponse.json(
      { error: 'Entity, code, or org match not found' },
      { status: 404 },
    );
  }

  return NextResponse.json({ ok: true });
}
