// CreditCard CRUD (PDR_MASTER §3.17, DECISIONS.md [G-S-29]).
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { CreditCard } from '@/lib/db/models/pm/CreditCard';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { creditCardCreateSchema } from '@/lib/validation/pm/creditCard';
import { logActivity } from '@/lib/pm/activity';

export const runtime = 'nodejs';

function serialize(d: Record<string, unknown>) {
  return {
    id: String(d._id),
    name: d.name,
    cardNumberMasked: d.cardNumberMasked,
    issuer: d.issuer ?? '',
    expirationDate: d.expirationDate ?? null,
    active: Boolean(d.active),
    // Phase 4 wiring once Bill / BillPayment exist.
    balance: 0,
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
  const rows = await CreditCard.find(filter).sort({ name: 1 }).lean();
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

  const parsed = creditCardCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  await connectToDatabase();
  const doc = await CreditCard.create({
    organizationId: new Types.ObjectId(ctx.orgId),
    name: parsed.data.name,
    cardNumberMasked: parsed.data.cardNumberMasked,
    issuer: parsed.data.issuer,
    expirationDate: parsed.data.expirationDate
      ? new Date(parsed.data.expirationDate)
      : null,
  });

  await logActivity({
    orgId: ctx.orgId,
    parentType: 'Task',
    parentId: doc._id,
    eventType: 'Credit card created',
    actorUserId: ctx.userId,
    payload: { name: doc.name },
  });

  return NextResponse.json(serialize(doc.toObject() as unknown as Record<string, unknown>), {
    status: 201,
  });
}
