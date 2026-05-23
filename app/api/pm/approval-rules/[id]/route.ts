// ApprovalRule per-row mutate + delete (BR-AC-19).
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { z } from 'zod';
import { connectToDatabase } from '@/lib/db/mongoose';
import { ApprovalRule } from '@/lib/db/models/pm/ApprovalRule';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { toCents } from '@/lib/pm/currency';
import { logActivity } from '@/lib/pm/activity';
import {
  APPROVAL_RULE_SEMANTICS,
  type ApprovalRuleSemantics,
} from '@/types/pm';

export const runtime = 'nodejs';

const objectIdString = z
  .string()
  .refine((v) => Types.ObjectId.isValid(v), { message: 'Invalid id' });

const ruleUpdateSchema = z
  .object({
    threshold: z.number().nonnegative().optional(),
    semantics: z
      .enum(APPROVAL_RULE_SEMANTICS as readonly [string, ...string[]])
      .optional(),
    approverUserIds: z.array(objectIdString).min(1).optional(),
    active: z.boolean().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: 'No fields to update',
  });

async function loadRule(orgId: string, id: string) {
  if (!Types.ObjectId.isValid(id)) return null;
  await connectToDatabase();
  return ApprovalRule.findOne({
    _id: new Types.ObjectId(id),
    organizationId: new Types.ObjectId(orgId),
  });
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const parsed = ruleUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const doc = await loadRule(ctx.orgId, params.id);
  if (!doc) {
    return NextResponse.json(
      { error: 'ApprovalRule not found' },
      { status: 404 },
    );
  }
  if (parsed.data.threshold !== undefined) {
    doc.thresholdCents = toCents(parsed.data.threshold);
  }
  if (parsed.data.semantics !== undefined)
    doc.semantics = parsed.data.semantics as ApprovalRuleSemantics;
  if (parsed.data.approverUserIds !== undefined) {
    doc.approverUserIds = parsed.data.approverUserIds.map(
      (id) => new Types.ObjectId(id),
    );
  }
  if (parsed.data.active !== undefined) doc.active = parsed.data.active;
  await doc.save();

  await logActivity({
    orgId: ctx.orgId,
    parentType: 'ApprovalRule',
    parentId: doc._id,
    eventType: 'ApprovalRule updated',
    actorUserId: ctx.userId,
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();
  const doc = await loadRule(ctx.orgId, params.id);
  if (!doc) {
    return NextResponse.json(
      { error: 'ApprovalRule not found' },
      { status: 404 },
    );
  }
  doc.active = false;
  await doc.save();
  await logActivity({
    orgId: ctx.orgId,
    parentType: 'ApprovalRule',
    parentId: doc._id,
    eventType: 'ApprovalRule deactivated',
    actorUserId: ctx.userId,
  });
  return NextResponse.json({ ok: true });
}
