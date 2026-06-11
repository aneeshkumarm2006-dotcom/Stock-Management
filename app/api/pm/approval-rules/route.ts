// ApprovalRule list + create (PDR §3.24, BR-AC-19, DECISIONS.md
// [G-S-31]). The settings page calls these to manage the per-company
// multi-approver chain. New EftRequests snapshot the resolved rule via
// `resolveApprovalRule` at create time.
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
import { canManageOrg } from '@/lib/pm/roles';
import {
  APPROVAL_RULE_SCOPE_TYPES,
  APPROVAL_RULE_SEMANTICS,
} from '@/types/pm';
import { computeWarnings } from '@/lib/pm/warnings';

export const runtime = 'nodejs';

const objectIdString = z
  .string()
  .refine((v) => Types.ObjectId.isValid(v), { message: 'Invalid id' });

// Presence requirements and "Property-scope requires scopeId" moved to
// computeWarnings (RULE_MISSING_SCOPE, RULE_MISSING_APPROVERS).
const ruleCreateSchema = z.object({
  scopeType: z
    .enum(APPROVAL_RULE_SCOPE_TYPES as readonly [string, ...string[]])
    .default('Company'),
  scopeId: objectIdString.optional(),
  /** Dollars; converted to cents server-side. */
  threshold: z.number().nonnegative().default(0),
  semantics: z
    .enum(APPROVAL_RULE_SEMANTICS as readonly [string, ...string[]])
    .default('any-of'),
  approverUserIds: z.array(objectIdString).default([]),
  active: z.boolean().optional(),
});

interface RuleLeanLike {
  _id: Types.ObjectId;
  scopeType: string;
  scopeId?: Types.ObjectId | null;
  thresholdCents: number;
  semantics: string;
  approverUserIds: Types.ObjectId[];
  active: boolean;
  updatedAt: Date;
}

function serializeRule(r: RuleLeanLike) {
  return {
    id: String(r._id),
    scopeType: r.scopeType,
    scopeId: r.scopeId ? String(r.scopeId) : null,
    thresholdCents: r.thresholdCents,
    semantics: r.semantics,
    approverUserIds: r.approverUserIds.map(String),
    active: r.active,
    updatedAt: r.updatedAt,
  };
}

export async function GET() {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();

  await connectToDatabase();
  const rows = await ApprovalRule.find({
    organizationId: new Types.ObjectId(ctx.orgId),
  })
    .sort({ active: -1, thresholdCents: -1 })
    .lean<RuleLeanLike[]>();
  return NextResponse.json(rows.map(serializeRule));
}

export async function POST(request: Request) {
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
  const parsed = ruleCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  await connectToDatabase();
  try {
    const doc = await ApprovalRule.create({
      organizationId: new Types.ObjectId(ctx.orgId),
      scopeType: parsed.data.scopeType,
      scopeId: parsed.data.scopeId
        ? new Types.ObjectId(parsed.data.scopeId)
        : null,
      thresholdCents: toCents(parsed.data.threshold),
      semantics: parsed.data.semantics,
      approverUserIds: parsed.data.approverUserIds.map(
        (id) => new Types.ObjectId(id),
      ),
      active: parsed.data.active ?? true,
      createdByUserId: new Types.ObjectId(ctx.userId),
    });
    const computed = computeWarnings(doc.toObject(), 'ApprovalRule');
    if (computed.length > 0) {
      doc.warnings = computed;
      await doc.save();
    }
    await logActivity({
      orgId: ctx.orgId,
      parentType: 'ApprovalRule',
      parentId: doc._id,
      eventType: 'ApprovalRule created',
      actorUserId: ctx.userId,
      payload: {
        thresholdCents: doc.thresholdCents,
        approverCount: doc.approverUserIds.length,
      },
    });
    return NextResponse.json(
      serializeRule(doc.toObject() as unknown as RuleLeanLike),
      { status: 201 },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to create rule';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
