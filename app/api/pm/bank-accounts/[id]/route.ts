// Per-row CRUD on BankAccount. DELETE soft-archives (BR-AC-18). Property FKs
// stay intact even when archived so historical references survive.
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { BankAccount } from '@/lib/db/models/pm/BankAccount';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { bankAccountUpdateSchema } from '@/lib/validation/pm/bankAccount';
import { logActivity } from '@/lib/pm/activity';

export const runtime = 'nodejs';

async function load(id: string, orgId: string) {
  if (!Types.ObjectId.isValid(id)) return null;
  await connectToDatabase();
  return BankAccount.findOne({
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
    purpose: doc.purpose ?? '',
    accountNumberMasked: doc.accountNumberMasked,
    type: doc.type,
    epayEnabled: doc.epayEnabled,
    retailCashEnabled: doc.retailCashEnabled,
    lastReconciliationDate: doc.lastReconciliationDate ?? null,
    isCompanyCash: doc.isCompanyCash,
    isDefault: doc.isDefault,
    active: doc.active,
    balance: 0,
    undepositedFunds: false,
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

  const parsed = bankAccountUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const doc = await load(params.id, ctx.orgId);
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // `lastReconciliationDate` arrives as ISO string from the client; coerce.
  const { lastReconciliationDate, ...rest } = parsed.data;
  Object.assign(doc, rest);
  if (lastReconciliationDate !== undefined) {
    doc.lastReconciliationDate = lastReconciliationDate
      ? new Date(lastReconciliationDate)
      : null;
  }
  await doc.save();

  await logActivity({
    orgId: ctx.orgId,
    parentType: 'Task',
    parentId: doc._id,
    eventType: 'Bank account updated',
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

  doc.active = false;
  await doc.save();

  await logActivity({
    orgId: ctx.orgId,
    parentType: 'Task',
    parentId: doc._id,
    eventType: 'Bank account archived',
    actorUserId: ctx.userId,
  });

  return NextResponse.json({ ok: true });
}
