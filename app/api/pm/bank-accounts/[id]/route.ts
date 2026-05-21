// Per-row CRUD on BankAccount. DELETE soft-archives (BR-AC-18). Property FKs
// stay intact even when archived so historical references survive. Phase 2:
// GET returns real `balance` / `undepositedFunds` from the GL; PATCH accepts
// `chartOfAccountId` mapping. Activity log entries now point at the
// BankAccount parentType (Phase 2 enum extension).
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
import { computeBankRollups } from '@/lib/pm/bankBalances';

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
  const rollups = await computeBankRollups(ctx.orgId, [doc._id]);
  const rollup = rollups.get(String(doc._id)) ?? {
    balance: 0,
    undepositedFunds: false,
  };
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
    chartOfAccountId: doc.chartOfAccountId ? String(doc.chartOfAccountId) : null,
    active: doc.active,
    balance: rollup.balance,
    undepositedFunds: rollup.undepositedFunds,
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
  // `chartOfAccountId` arrives as a string; coerce to ObjectId.
  const { lastReconciliationDate, chartOfAccountId, ...rest } = parsed.data;
  Object.assign(doc, rest);
  if (lastReconciliationDate !== undefined) {
    doc.lastReconciliationDate = lastReconciliationDate
      ? new Date(lastReconciliationDate)
      : null;
  }
  if (chartOfAccountId !== undefined) {
    doc.chartOfAccountId = chartOfAccountId
      ? new Types.ObjectId(chartOfAccountId)
      : null;
  }
  await doc.save();

  await logActivity({
    orgId: ctx.orgId,
    parentType: 'BankAccount',
    parentId: doc._id,
    eventType:
      chartOfAccountId !== undefined
        ? 'Bank account → CoA mapped'
        : 'Bank account updated',
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
    parentType: 'BankAccount',
    parentId: doc._id,
    eventType: 'Bank account archived',
    actorUserId: ctx.userId,
  });

  return NextResponse.json({ ok: true });
}
