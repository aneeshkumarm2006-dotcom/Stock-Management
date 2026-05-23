// Budget CRUD (PDR §3.26 + §3.26a, BR-AC-11). GET supports the
// /properties/accounting/budgets list view filters (?fiscalYear,
// ?scopeId, ?includeArchived). POST creates a Budget, then seeds
// `lines[]` based on `defaultAmounts`:
//   - 'Zero'                     → respect any `lines[]` from the client (default empty).
//   - 'Copy previous FY actuals' → invoke `copyPriorFyActuals` and merge.
//   - 'Copy existing budget'     → invoke `copyExistingBudgetLines`.
//
// Storage convention: monthlyAmounts arrive as dollars and get
// multiplied by 100 (toCents) before save.
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { Budget } from '@/lib/db/models/pm/Budget';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { budgetCreateSchema } from '@/lib/validation/pm/budget';
import { logActivity } from '@/lib/pm/activity';
import { toCents } from '@/lib/pm/currency';
import {
  computeFiscalYearWindow,
  copyExistingBudgetLines,
  copyPriorFyActuals,
  type BudgetLineSeed,
} from '@/lib/pm/budgetActualsCopy';
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
    accountId: Types.ObjectId;
    category: 'Income' | 'Expense';
    monthlyAmounts: number[];
  }>;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

function totalsFromLines(lines: BudgetLeanLike['lines']): {
  totalIncomeCents: number;
  totalExpensesCents: number;
} {
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

function serializeRow(b: BudgetLeanLike) {
  const { totalIncomeCents, totalExpensesCents } = totalsFromLines(b.lines ?? []);
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
    totalIncomeCents,
    totalExpensesCents,
    active: b.active,
    lineCount: b.lines?.length ?? 0,
    updatedAt: b.updatedAt,
  };
}

export async function GET(request: Request) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();

  const { searchParams } = new URL(request.url);
  const fiscalYear = searchParams.get('fiscalYear');
  const scopeId = searchParams.get('scopeId');
  const includeArchived = searchParams.get('includeArchived') === '1';

  await connectToDatabase();
  const filter: Record<string, unknown> = {
    organizationId: new Types.ObjectId(ctx.orgId),
  };
  if (!includeArchived) filter.active = true;
  if (fiscalYear && /^\d{4}$/.test(fiscalYear)) {
    filter.fiscalYear = Number(fiscalYear);
  }
  if (scopeId && Types.ObjectId.isValid(scopeId)) {
    filter.scopeId = new Types.ObjectId(scopeId);
  }

  const rows = await Budget.find(filter)
    .sort({ fiscalYear: -1, updatedAt: -1 })
    .lean<BudgetLeanLike[]>();

  return NextResponse.json(rows.map(serializeRow));
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

  const parsed = budgetCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  await connectToDatabase();
  const orgObjectId = new Types.ObjectId(ctx.orgId);
  const scopeObjectId = new Types.ObjectId(parsed.data.scopeId);

  // Pre-check the per-property uniqueness so we can return a nice 409.
  if (parsed.data.scopeType === 'Property') {
    const existing = await Budget.findOne({
      organizationId: orgObjectId,
      scopeType: 'Property',
      scopeId: scopeObjectId,
      fiscalYear: parsed.data.fiscalYear,
    }).lean<{ _id: Types.ObjectId } | null>();
    if (existing) {
      return NextResponse.json(
        {
          error: `A budget for FY${parsed.data.fiscalYear} already exists on this property (BR-AC-11).`,
        },
        { status: 409 },
      );
    }
  }

  // Compute startDate / endDate from FY label + fiscalYearStart.
  const { startDate, endDate } = computeFiscalYearWindow(
    parsed.data.fiscalYear,
    parsed.data.fiscalYearStart as FiscalMonth,
  );

  // Seed lines per defaultAmounts. Client-supplied `lines[]` is treated
  // as the source of truth ONLY when defaultAmounts === 'Zero' — the
  // copy modes overwrite whatever the client sent.
  let seedLines: BudgetLineSeed[] = (parsed.data.lines ?? []).map((l) => ({
    accountId: new Types.ObjectId(l.accountId),
    category: l.category as 'Income' | 'Expense',
    monthlyAmounts: l.monthlyAmounts.map((d) => toCents(d)),
  }));

  if (parsed.data.defaultAmounts === 'Copy previous FY actuals') {
    seedLines = await copyPriorFyActuals({
      orgId: orgObjectId,
      scopePropertyId:
        parsed.data.scopeType === 'Property' ? scopeObjectId : null,
      fiscalYear: parsed.data.fiscalYear,
      fiscalYearStart: parsed.data.fiscalYearStart as FiscalMonth,
    });
  } else if (
    parsed.data.defaultAmounts === 'Copy existing budget' &&
    parsed.data.copySourceBudgetId
  ) {
    seedLines = await copyExistingBudgetLines({
      orgId: orgObjectId,
      sourceBudgetId: new Types.ObjectId(parsed.data.copySourceBudgetId),
    });
  }

  try {
    const doc = await Budget.create({
      organizationId: orgObjectId,
      scopeType: parsed.data.scopeType,
      scopeId: scopeObjectId,
      name: parsed.data.name,
      fiscalYear: parsed.data.fiscalYear,
      fiscalYearStart: parsed.data.fiscalYearStart,
      startDate,
      endDate,
      defaultAmounts: parsed.data.defaultAmounts,
      copySourceBudgetId: parsed.data.copySourceBudgetId
        ? new Types.ObjectId(parsed.data.copySourceBudgetId)
        : null,
      lines: seedLines,
      active: true,
      createdByUserId: new Types.ObjectId(ctx.userId),
    });

    await logActivity({
      orgId: ctx.orgId,
      parentType: 'Budget',
      parentId: doc._id,
      eventType: 'Budget created',
      actorUserId: ctx.userId,
      payload: {
        scopeType: doc.scopeType,
        fiscalYear: doc.fiscalYear,
        lineCount: doc.lines.length,
      },
    });

    return NextResponse.json(
      serializeRow(doc.toObject() as unknown as BudgetLeanLike),
      { status: 201 },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to save budget';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
