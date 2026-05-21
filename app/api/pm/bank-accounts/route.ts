// BankAccount CRUD (PDR_MASTER §3.16). Phase 2 wires real `balance` /
// `undepositedFunds` roll-ups from JournalEntry lines and accepts the new
// `chartOfAccountId` mapping that ties this bank to its underlying GL cash
// account (required for JE/Deposit postings to route through). Account
// numbers are always returned masked (BR-AC-13).
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
import { computeBankRollups } from '@/lib/pm/bankBalances';

export const runtime = 'nodejs';

interface BankSerializable {
  id: string;
  name: string;
  purpose: string;
  accountNumberMasked: string;
  type: string;
  epayEnabled: boolean;
  retailCashEnabled: boolean;
  lastReconciliationDate: Date | string | null;
  isCompanyCash: boolean;
  isDefault: boolean;
  chartOfAccountId: string | null;
  active: boolean;
  balance: number;
  undepositedFunds: boolean;
}

function serialize(
  d: Record<string, unknown>,
  rollup: { balance: number; undepositedFunds: boolean } = {
    balance: 0,
    undepositedFunds: false,
  },
): BankSerializable {
  return {
    id: String(d._id),
    name: (d.name as string) ?? '',
    purpose: (d.purpose as string) ?? '',
    accountNumberMasked: (d.accountNumberMasked as string) ?? '',
    type: (d.type as string) ?? 'Checking',
    epayEnabled: Boolean(d.epayEnabled),
    retailCashEnabled: Boolean(d.retailCashEnabled),
    lastReconciliationDate: (d.lastReconciliationDate as Date | null) ?? null,
    isCompanyCash: Boolean(d.isCompanyCash),
    isDefault: Boolean(d.isDefault),
    chartOfAccountId: d.chartOfAccountId ? String(d.chartOfAccountId) : null,
    active: Boolean(d.active),
    balance: rollup.balance,
    undepositedFunds: rollup.undepositedFunds,
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
  const rollups = await computeBankRollups(
    ctx.orgId,
    rows.map((r) => r._id),
  );
  return NextResponse.json(
    rows.map((r) => serialize(r as Record<string, unknown>, rollups.get(String(r._id)))),
  );
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
    chartOfAccountId: parsed.data.chartOfAccountId
      ? new Types.ObjectId(parsed.data.chartOfAccountId)
      : null,
  });

  await logActivity({
    orgId: ctx.orgId,
    parentType: 'BankAccount',
    parentId: doc._id,
    eventType: 'Bank account created',
    actorUserId: ctx.userId,
    payload: { name: doc.name, type: doc.type },
  });

  return NextResponse.json(serialize(doc.toObject() as unknown as Record<string, unknown>), {
    status: 201,
  });
}
