// BillPayment CRUD (PDR §3.22). POST creates the payment, posts the JE,
// and rolls up Bill.status to Partially paid / Paid via
// `postBillPaymentToLedger`.
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { BillPayment } from '@/lib/db/models/pm/BillPayment';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { billPaymentCreateSchema } from '@/lib/validation/pm/billPayment';
import { toCents } from '@/lib/pm/currency';
import { logActivity } from '@/lib/pm/activity';
import {
  postBillPaymentToLedger,
  LockedPeriodError,
} from '@/lib/pm/postBillPaymentToLedger';

export const runtime = 'nodejs';

interface BpLeanLike {
  _id: unknown;
  billId: unknown;
  bankAccountId?: unknown;
  paymentMethod: string;
  checkNumber?: string;
  amount: number;
  paidDate: Date;
  journalEntryId?: unknown;
}

export async function GET(request: Request) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();

  const { searchParams } = new URL(request.url);
  const billId = searchParams.get('billId');

  await connectToDatabase();
  const filter: Record<string, unknown> = {
    organizationId: new Types.ObjectId(ctx.orgId),
  };
  if (billId && Types.ObjectId.isValid(billId)) {
    filter.billId = new Types.ObjectId(billId);
  }

  const rows = await BillPayment.find(filter)
    .sort({ paidDate: -1 })
    .lean<BpLeanLike[]>();

  return NextResponse.json(
    rows.map((r) => ({
      id: String(r._id),
      billId: String(r.billId),
      bankAccountId: r.bankAccountId ? String(r.bankAccountId) : null,
      paymentMethod: r.paymentMethod,
      checkNumber: r.checkNumber ?? '',
      amount: r.amount,
      paidDate: r.paidDate,
      journalEntryId: r.journalEntryId ? String(r.journalEntryId) : null,
    })),
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

  const parsed = billPaymentCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  await connectToDatabase();
  const orgObjectId = new Types.ObjectId(ctx.orgId);

  const paidDate = new Date(parsed.data.paidDate);
  if (Number.isNaN(paidDate.getTime())) {
    return NextResponse.json({ error: 'Invalid paidDate' }, { status: 400 });
  }

  const amountCents = toCents(parsed.data.amount);

  try {
    const payment = await BillPayment.create({
      organizationId: orgObjectId,
      billId: new Types.ObjectId(parsed.data.billId),
      bankAccountId: parsed.data.bankAccountId
        ? new Types.ObjectId(parsed.data.bankAccountId)
        : null,
      paymentMethod: parsed.data.paymentMethod,
      checkNumber: parsed.data.checkNumber,
      amount: amountCents,
      paidDate,
      createdByUserId: new Types.ObjectId(ctx.userId),
    });

    const result = await postBillPaymentToLedger({
      orgId: ctx.orgId,
      ctx,
      billId: payment.billId,
      bankAccountId: payment.bankAccountId ?? null,
      amount: amountCents,
      paidDate,
    });
    payment.journalEntryId = result.journalEntryId;
    await payment.save();

    await logActivity({
      orgId: ctx.orgId,
      parentType: 'BillPayment',
      parentId: payment._id,
      eventType: 'Bill payment posted',
      actorUserId: ctx.userId,
      payload: {
        billId: String(payment.billId),
        amount: payment.amount,
        method: payment.paymentMethod,
      },
    });

    return NextResponse.json(
      {
        id: String(payment._id),
        journalEntryId: String(result.journalEntryId),
        billStatus: result.newBillStatus,
      },
      { status: 201 },
    );
  } catch (err) {
    if (err instanceof LockedPeriodError) {
      return NextResponse.json(
        { error: err.policyMessage, policyId: err.policyId },
        { status: 423 },
      );
    }
    const msg = err instanceof Error ? err.message : 'Failed to post payment';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
