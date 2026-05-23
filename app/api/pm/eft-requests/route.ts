// EftRequest CRUD (PDR §3.24). New EFTs land in Pending status and queue
// for approval at /accounting/eft-approvals.
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { EftRequest } from '@/lib/db/models/pm/EftRequest';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { eftRequestCreateSchema } from '@/lib/validation/pm/eftRequest';
import { toCents } from '@/lib/pm/currency';
import { logActivity } from '@/lib/pm/activity';
import { resolveApprovalRule } from '@/lib/pm/approvalRules';

export const runtime = 'nodejs';

interface EftLeanLike {
  _id: unknown;
  date: Date;
  bankAccountId: unknown;
  paidToName: string;
  payee: { type: string; id: unknown };
  status: string;
  amount: number;
  approverUserId?: unknown;
  billId?: unknown;
  propertiesScope?: string;
  appliedRuleId?: unknown;
  approvals?: Array<{
    userId: unknown;
    decision: string;
    at: Date;
    comment?: string;
  }>;
}

export async function GET(request: Request) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status');

  await connectToDatabase();
  const filter: Record<string, unknown> = {
    organizationId: new Types.ObjectId(ctx.orgId),
  };
  if (status) filter.status = status;

  const rows = await EftRequest.find(filter)
    .sort({ date: -1 })
    .lean<EftLeanLike[]>();

  return NextResponse.json(
    rows.map((r) => ({
      id: String(r._id),
      date: r.date,
      bankAccountId: String(r.bankAccountId),
      paidToName: r.paidToName,
      payee: { type: r.payee.type, id: String(r.payee.id) },
      status: r.status,
      amount: r.amount,
      approverUserId: r.approverUserId ? String(r.approverUserId) : null,
      billId: r.billId ? String(r.billId) : null,
      propertiesScope: r.propertiesScope ?? '',
      appliedRuleId: r.appliedRuleId ? String(r.appliedRuleId) : null,
      approvals: (r.approvals ?? []).map((a) => ({
        userId: String(a.userId),
        decision: a.decision,
        at: a.at,
        comment: a.comment ?? null,
      })),
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

  const parsed = eftRequestCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  await connectToDatabase();

  const date = new Date(parsed.data.date);
  if (Number.isNaN(date.getTime())) {
    return NextResponse.json({ error: 'Invalid date' }, { status: 400 });
  }

  const amountCents = toCents(parsed.data.amount);
  // Phase 9 — snapshot the active ApprovalRule onto the EFT so later
  // approve/reject calls have a stable rule reference even if the rule
  // is edited or deactivated post-create (BR-AC-19).
  const rule = await resolveApprovalRule({
    orgId: ctx.orgId,
    amountCents,
    billId: parsed.data.billId ?? null,
  });

  const doc = await EftRequest.create({
    organizationId: new Types.ObjectId(ctx.orgId),
    date,
    bankAccountId: new Types.ObjectId(parsed.data.bankAccountId),
    paidToName: parsed.data.paidToName,
    payee: {
      type: parsed.data.payee.type,
      id: new Types.ObjectId(parsed.data.payee.id),
    },
    propertiesScope: parsed.data.propertiesScope,
    status: 'Pending',
    amount: amountCents,
    billId: parsed.data.billId ? new Types.ObjectId(parsed.data.billId) : null,
    appliedRuleId: rule?.ruleId ?? null,
    approvals: [],
    createdByUserId: new Types.ObjectId(ctx.userId),
  });

  await logActivity({
    orgId: ctx.orgId,
    parentType: 'EftRequest',
    parentId: doc._id,
    eventType: 'EFT request created',
    actorUserId: ctx.userId,
    payload: { amount: doc.amount, payee: parsed.data.payee },
  });

  return NextResponse.json({ id: String(doc._id) }, { status: 201 });
}
