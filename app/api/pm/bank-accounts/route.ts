// BankAccount CRUD (PDR_MASTER §3.16). Derived `balance` /
// `undepositedFunds` are returned as zeros in Phase 1 — Phase 2 wires the
// JournalLine roll-up. Account numbers are always returned masked (BR-AC-13).
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { BankAccount } from '@/lib/db/models/pm/BankAccount';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { bankAccountCreateSchema } from '@/lib/validation/pm/bankAccount';
import { logActivity } from '@/lib/pm/activity';

export const runtime = 'nodejs';

function serialize(d: Record<string, unknown>) {
  return {
    id: String(d._id),
    name: d.name,
    purpose: d.purpose ?? '',
    accountNumberMasked: d.accountNumberMasked,
    type: d.type,
    epayEnabled: Boolean(d.epayEnabled),
    retailCashEnabled: Boolean(d.retailCashEnabled),
    lastReconciliationDate: d.lastReconciliationDate ?? null,
    isCompanyCash: Boolean(d.isCompanyCash),
    isDefault: Boolean(d.isDefault),
    active: Boolean(d.active),
    // Phase 2 wiring — see BR-AC-7. Returned as zero until ledger lands.
    balance: 0,
    undepositedFunds: false,
  };
}

export async function GET(request: Request) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();

  const { searchParams } = new URL(request.url);
  const includeInactive = searchParams.get('includeInactive') === '1';

  await connectToDatabase();
  const filter: Record<string, unknown> = {
    organizationId: new Types.ObjectId(ctx.orgId),
  };
  if (!includeInactive) filter.active = true;

  const rows = await BankAccount.find(filter).sort({ name: 1 }).lean();
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

  const parsed = bankAccountCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  await connectToDatabase();
  const doc = await BankAccount.create({
    organizationId: new Types.ObjectId(ctx.orgId),
    name: parsed.data.name,
    purpose: parsed.data.purpose,
    accountNumberMasked: parsed.data.accountNumberMasked,
    type: parsed.data.type,
    epayEnabled: parsed.data.epayEnabled ?? false,
    retailCashEnabled: parsed.data.retailCashEnabled ?? false,
    isCompanyCash: parsed.data.isCompanyCash ?? false,
    isDefault: parsed.data.isDefault ?? false,
  });

  await logActivity({
    orgId: ctx.orgId,
    parentType: 'Task',
    parentId: doc._id,
    eventType: 'Bank account created',
    actorUserId: ctx.userId,
    payload: { name: doc.name, type: doc.type },
  });

  return NextResponse.json(serialize(doc.toObject() as unknown as Record<string, unknown>), {
    status: 201,
  });
}
