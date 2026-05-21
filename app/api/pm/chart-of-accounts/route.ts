// ChartOfAccount CRUD (PDR_MASTER §3.18). System-seeded baseline rows are
// upserted lazily on first GET when an org has none — backfills pre-Phase-1
// orgs without a migration script.
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { ChartOfAccount } from '@/lib/db/models/pm/ChartOfAccount';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { chartOfAccountCreateSchema } from '@/lib/validation/pm/chartOfAccount';
import { logActivity } from '@/lib/pm/activity';
import { seedSystemAccounts } from '@/lib/pm/seed';

export const runtime = 'nodejs';

function serialize(d: Record<string, unknown>) {
  return {
    id: String(d._id),
    name: d.name,
    type: d.type,
    defaultFor: d.defaultFor ?? null,
    cashFlowClassification: d.cashFlowClassification ?? 'N/A',
    accountNumber: d.accountNumber ?? '',
    notes: d.notes ?? '',
    systemSeeded: Boolean(d.systemSeeded),
    active: Boolean(d.active),
  };
}

export async function GET(request: Request) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();

  const { searchParams } = new URL(request.url);
  const includeInactive = searchParams.get('includeInactive') === '1';

  await connectToDatabase();
  const orgObjectId = new Types.ObjectId(ctx.orgId);

  // Lazy backfill for orgs that pre-date the Phase 1 seed.
  const seededCount = await ChartOfAccount.countDocuments({
    organizationId: orgObjectId,
    systemSeeded: true,
  });
  if (seededCount === 0) {
    await seedSystemAccounts(orgObjectId);
  }

  const filter: Record<string, unknown> = { organizationId: orgObjectId };
  if (!includeInactive) filter.active = true;
  const rows = await ChartOfAccount.find(filter)
    .sort({ type: 1, name: 1 })
    .lean();

  return NextResponse.json(rows.map(serialize));
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

  const parsed = chartOfAccountCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  await connectToDatabase();
  try {
    const doc = await ChartOfAccount.create({
      organizationId: new Types.ObjectId(ctx.orgId),
      name: parsed.data.name,
      type: parsed.data.type,
      defaultFor: parsed.data.defaultFor ?? null,
      cashFlowClassification: parsed.data.cashFlowClassification ?? 'N/A',
      accountNumber: parsed.data.accountNumber,
      notes: parsed.data.notes,
      systemSeeded: false,
    });

    await logActivity({
      orgId: ctx.orgId,
      // Account-level event — no natural polymorphic parent yet.
      parentType: 'Task',
      parentId: doc._id,
      eventType: 'Chart of account created',
      actorUserId: ctx.userId,
      payload: { name: doc.name, type: doc.type },
    });

    return NextResponse.json(serialize(doc.toObject() as unknown as Record<string, unknown>), {
      status: 201,
    });
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
}
