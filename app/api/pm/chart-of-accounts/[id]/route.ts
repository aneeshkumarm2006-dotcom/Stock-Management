// Per-row CRUD on ChartOfAccount. System-seeded rows cannot be renamed,
// retyped, or deleted (BR-AC-4). DELETE soft-archives (active=false) per
// BR-AC-18 — Phase 2 will block deletion entirely when JournalEntry refs exist.
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { ChartOfAccount } from '@/lib/db/models/pm/ChartOfAccount';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { chartOfAccountUpdateSchema } from '@/lib/validation/pm/chartOfAccount';
import { logActivity } from '@/lib/pm/activity';

export const runtime = 'nodejs';

async function load(id: string, orgId: string) {
  if (!Types.ObjectId.isValid(id)) return null;
  await connectToDatabase();
  return ChartOfAccount.findOne({
    _id: new Types.ObjectId(id),
    organizationId: new Types.ObjectId(orgId),
  });
}

export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();
  const doc = await load(params.id, ctx.orgId);
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({
    id: String(doc._id),
    name: doc.name,
    type: doc.type,
    defaultFor: doc.defaultFor ?? null,
    cashFlowClassification: doc.cashFlowClassification ?? 'N/A',
    accountNumber: doc.accountNumber ?? '',
    notes: doc.notes ?? '',
    systemSeeded: doc.systemSeeded,
    active: doc.active,
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

  const parsed = chartOfAccountUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const doc = await load(params.id, ctx.orgId);
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (doc.systemSeeded) {
    // System-seeded rows are immutable except for `accountNumber` / `notes`
    // (cosmetic) and `active` (BR-AC-18 — inactivate, never delete).
    const immutableTouched =
      parsed.data.name !== undefined ||
      parsed.data.type !== undefined ||
      parsed.data.defaultFor !== undefined ||
      parsed.data.cashFlowClassification !== undefined;
    if (immutableTouched) {
      return NextResponse.json(
        { error: 'System-seeded accounts cannot be renamed or retyped' },
        { status: 400 },
      );
    }
  }

  try {
    Object.assign(doc, parsed.data);
    await doc.save();
  } catch (err: unknown) {
    if (
      err &&
      typeof err === 'object' &&
      (err as { code?: number }).code === 11000
    ) {
      return NextResponse.json(
        { error: 'An account with this name or defaultFor role already exists' },
        { status: 409 },
      );
    }
    throw err;
  }

  await logActivity({
    orgId: ctx.orgId,
    parentType: 'Task',
    parentId: doc._id,
    eventType: 'Chart of account updated',
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

  const doc = await load(params.id, ctx.orgId);
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (doc.systemSeeded) {
    return NextResponse.json(
      { error: 'System-seeded accounts cannot be deleted; inactivate instead' },
      { status: 400 },
    );
  }

  // Phase 2 will block delete entirely when JournalEntry referenes this
  // account; for now soft-archive matches the wider BR-AC-18 pattern.
  doc.active = false;
  await doc.save();

  await logActivity({
    orgId: ctx.orgId,
    parentType: 'Task',
    parentId: doc._id,
    eventType: 'Chart of account archived',
    actorUserId: ctx.userId,
  });

  return NextResponse.json({ ok: true });
}
