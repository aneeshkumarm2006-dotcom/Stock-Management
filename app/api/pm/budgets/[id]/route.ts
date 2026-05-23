// Budget detail + mutate (PDR §3.26 + §3.26a). GET returns the full
// Budget including embedded `lines[]` (already in cents). PATCH accepts
// rename, archive (`active`), and whole `lines[]` replacement; the grid
// editor sends the entire 12-month-per-line payload on debounce.
// DELETE soft-deletes via `active=false` for Phase 9; hard-delete is
// reserved for the admin tool.
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { Budget } from '@/lib/db/models/pm/Budget';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { budgetUpdateSchema } from '@/lib/validation/pm/budget';
import { logActivity } from '@/lib/pm/activity';
import { toCents } from '@/lib/pm/currency';
import type { FiscalMonth } from '@/types/pm';

export const runtime = 'nodejs';

interface BudgetLeanLike {
  _id: Types.ObjectId;
  scopeType: 'Property' | 'Company';
  scopeId: Types.ObjectId;
  name: string;
  fiscalYear: number;
  fiscalYearStart: FiscalMonth;
  startDate: Date;
  endDate: Date;
  defaultAmounts: string;
  copySourceBudgetId?: Types.ObjectId | null;
  lines: Array<{
    _id: Types.ObjectId;
    accountId: Types.ObjectId;
    category: 'Income' | 'Expense';
    monthlyAmounts: number[];
  }>;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

function totalsFromLines(lines: BudgetLeanLike['lines']) {
  let income = 0;
  let expense = 0;
  for (const l of lines ?? []) {
    const sum = (l.monthlyAmounts ?? []).reduce(
      (a, b) => a + (Number.isFinite(b) ? b : 0),
      0,
    );
    if (l.category === 'Income') income += sum;
    else expense += sum;
  }
  return { totalIncomeCents: income, totalExpensesCents: expense };
}

function serializeDetail(b: BudgetLeanLike) {
  const totals = totalsFromLines(b.lines ?? []);
  return {
    id: String(b._id),
    scopeType: b.scopeType,
    scopeId: String(b.scopeId),
    name: b.name,
    fiscalYear: b.fiscalYear,
    fiscalYearStart: b.fiscalYearStart,
    startDate: b.startDate,
    endDate: b.endDate,
    defaultAmounts: b.defaultAmounts,
    copySourceBudgetId: b.copySourceBudgetId
      ? String(b.copySourceBudgetId)
      : null,
    active: b.active,
    totalIncomeCents: totals.totalIncomeCents,
    totalExpensesCents: totals.totalExpensesCents,
    lines: (b.lines ?? []).map((l) => ({
      id: l._id ? String(l._id) : undefined,
      accountId: String(l.accountId),
      category: l.category,
      monthlyAmounts: l.monthlyAmounts ?? new Array(12).fill(0),
      fyTotalCents: (l.monthlyAmounts ?? []).reduce(
        (a, b) => a + (Number.isFinite(b) ? b : 0),
        0,
      ),
    })),
    updatedAt: b.updatedAt,
  };
}

async function loadDoc(orgId: string, id: string) {
  if (!Types.ObjectId.isValid(id)) return null;
  await connectToDatabase();
  return Budget.findOne({
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

  const doc = await loadDoc(ctx.orgId, params.id);
  if (!doc) {
    return NextResponse.json({ error: 'Budget not found' }, { status: 404 });
  }
  return NextResponse.json(
    serializeDetail(doc.toObject() as unknown as BudgetLeanLike),
  );
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
  const parsed = budgetUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const doc = await loadDoc(ctx.orgId, params.id);
  if (!doc) {
    return NextResponse.json({ error: 'Budget not found' }, { status: 404 });
  }

  const changes: string[] = [];
  if (parsed.data.name !== undefined && parsed.data.name !== doc.name) {
    doc.name = parsed.data.name;
    changes.push('name');
  }
  if (parsed.data.active !== undefined && parsed.data.active !== doc.active) {
    doc.active = parsed.data.active;
    changes.push(parsed.data.active ? 'unarchived' : 'archived');
  }
  if (parsed.data.lines !== undefined) {
    doc.lines = parsed.data.lines.map((l) => ({
      accountId: new Types.ObjectId(l.accountId),
      category: l.category as 'Income' | 'Expense',
      monthlyAmounts: l.monthlyAmounts.map((d) => toCents(d)),
    })) as typeof doc.lines;
    changes.push('lines');
  }

  if (changes.length === 0) {
    return NextResponse.json(
      serializeDetail(doc.toObject() as unknown as BudgetLeanLike),
    );
  }

  try {
    await doc.save();
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to save budget';
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  await logActivity({
    orgId: ctx.orgId,
    parentType: 'Budget',
    parentId: doc._id,
    eventType: 'Budget updated',
    actorUserId: ctx.userId,
    payload: { changes },
  });

  return NextResponse.json(
    serializeDetail(doc.toObject() as unknown as BudgetLeanLike),
  );
}

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();

  const doc = await loadDoc(ctx.orgId, params.id);
  if (!doc) {
    return NextResponse.json({ error: 'Budget not found' }, { status: 404 });
  }
  doc.active = false;
  await doc.save();

  await logActivity({
    orgId: ctx.orgId,
    parentType: 'Budget',
    parentId: doc._id,
    eventType: 'Budget archived',
    actorUserId: ctx.userId,
  });

  return NextResponse.json({ ok: true });
}
