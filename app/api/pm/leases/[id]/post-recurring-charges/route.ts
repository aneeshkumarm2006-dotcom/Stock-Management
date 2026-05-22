// POST /api/pm/leases/:id/post-recurring-charges
//
// Iterates `recurringCharges[]` on the lease, posts a JournalEntry per row
// whose `nextDate` is on or before `asOfDate` (defaults to now), and advances
// `nextDate` by the row's `frequency`. Each post hits `assertWriteAllowed`
// independently — locked periods block any due charge inside the window.
//
// TODO Phase 6 — wire a nightly cron at 02:00 org-tz that fans out across
// orgs and active leases. Until then this is the manual button on the lease
// detail page.
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { z } from 'zod';
import { connectToDatabase } from '@/lib/db/mongoose';
import { Lease } from '@/lib/db/models/pm/Lease';
import { Property } from '@/lib/db/models/pm/Property';
import { BankAccount } from '@/lib/db/models/pm/BankAccount';
import { ChartOfAccount } from '@/lib/db/models/pm/ChartOfAccount';
import { JournalEntry } from '@/lib/db/models/pm/JournalEntry';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { logActivity } from '@/lib/pm/activity';
import {
  assertWriteAllowed,
  LockedPeriodError,
} from '@/lib/pm/lockedPeriod';
import type { RentCycle } from '@/types/pm';

export const runtime = 'nodejs';

const DAY_MS = 24 * 60 * 60 * 1000;
const bodySchema = z.object({
  asOfDate: z.string().min(8).optional(),
});

function advance(date: Date, freq: RentCycle): Date {
  const next = new Date(date);
  switch (freq) {
    case 'Weekly':
      next.setDate(next.getDate() + 7);
      break;
    case 'Bi-weekly':
      next.setDate(next.getDate() + 14);
      break;
    case 'Monthly':
      next.setMonth(next.getMonth() + 1);
      break;
    case 'Quarterly':
      next.setMonth(next.getMonth() + 3);
      break;
    case 'Yearly':
      next.setFullYear(next.getFullYear() + 1);
      break;
  }
  return next;
}

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();
  if (!Types.ObjectId.isValid(params.id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }

  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    // empty body OK
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }
  const asOf = parsed.data.asOfDate ? new Date(parsed.data.asOfDate) : new Date();
  if (Number.isNaN(asOf.getTime())) {
    return NextResponse.json({ error: 'Invalid asOfDate' }, { status: 400 });
  }

  await connectToDatabase();
  const orgId = new Types.ObjectId(ctx.orgId);
  const lease = await Lease.findOne({
    _id: new Types.ObjectId(params.id),
    organizationId: orgId,
  });
  if (!lease) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (lease.status !== 'Active' && lease.status !== 'Future') {
    return NextResponse.json(
      {
        error: 'Recurring charges only post against Active or Future leases.',
      },
      { status: 409 },
    );
  }

  // Resolve operating-cash CoA via Property → BankAccount, falling back to
  // the system-seeded `Operating Cash` CoA if the mapping is missing.
  const property = await Property.findOne({
    _id: lease.propertyId,
    organizationId: orgId,
  })
    .select({ operatingAccountId: 1, propertyName: 1 })
    .lean<{
      _id: Types.ObjectId;
      operatingAccountId: Types.ObjectId;
      propertyName: string;
    } | null>();
  if (!property) {
    return NextResponse.json({ error: 'Property missing' }, { status: 409 });
  }
  const opBank = await BankAccount.findOne({
    _id: property.operatingAccountId,
    organizationId: orgId,
  })
    .select({ chartOfAccountId: 1 })
    .lean<{ chartOfAccountId?: Types.ObjectId | null } | null>();
  let operatingCashCoaId = opBank?.chartOfAccountId ?? null;
  if (!operatingCashCoaId) {
    const fallback = await ChartOfAccount.findOne({
      organizationId: orgId,
      defaultFor: 'Operating Cash',
      active: true,
    })
      .select({ _id: 1 })
      .lean<{ _id: Types.ObjectId } | null>();
    operatingCashCoaId = fallback?._id ?? null;
  }
  if (!operatingCashCoaId) {
    return NextResponse.json(
      {
        error:
          'No Operating Cash chart-of-account configured; cannot post recurring charges.',
      },
      { status: 409 },
    );
  }

  const posted: Array<{
    chargeId: string;
    amount: number;
    journalEntryId: string;
    newNextDate: string;
  }> = [];
  const skipped: Array<{ chargeId: string; reason: string }> = [];

  for (const charge of lease.recurringCharges) {
    if (!charge.nextDate) continue;
    if (charge.nextDate > asOf) continue;
    try {
      await assertWriteAllowed({
        orgId: ctx.orgId,
        txnDate: charge.nextDate,
        scopePropertyId: String(lease.propertyId),
        ctx,
      });
    } catch (err) {
      if (err instanceof LockedPeriodError) {
        skipped.push({
          chargeId: String((charge as { _id?: unknown })._id ?? ''),
          reason: err.policyMessage,
        });
        continue;
      }
      throw err;
    }

    const je = await JournalEntry.create({
      organizationId: orgId,
      date: charge.nextDate,
      scopeType: 'Property',
      scopeId: lease.propertyId,
      memo: `Recurring charge for lease #${lease.leaseNumber} (${charge.memo ?? charge.frequency})`,
      lines: [
        {
          accountId: operatingCashCoaId,
          scopeType: 'Property',
          scopeId: lease.propertyId,
          unitId: lease.unitId,
          description: 'Recurring rent collected',
          debit: charge.amount,
          credit: 0,
        },
        {
          accountId: charge.accountId,
          scopeType: 'Property',
          scopeId: lease.propertyId,
          unitId: lease.unitId,
          description: 'Recurring rent income',
          debit: 0,
          credit: charge.amount,
        },
      ],
      status: 'Posted',
      postedAt: new Date(),
      createdByUserId: new Types.ObjectId(ctx.userId),
    });

    const newNext = advance(charge.nextDate, charge.frequency);
    charge.nextDate = newNext;
    posted.push({
      chargeId: String((charge as { _id?: unknown })._id ?? ''),
      amount: charge.amount,
      journalEntryId: String(je._id),
      newNextDate: newNext.toISOString(),
    });
  }

  if (posted.length > 0) {
    await lease.save();
    await logActivity({
      orgId: ctx.orgId,
      parentType: 'Lease',
      parentId: lease._id,
      eventType: 'Recurring charges posted',
      actorUserId: ctx.userId,
      payload: { count: posted.length, asOfDate: asOf.toISOString() },
    });
  }

  // Bonus loop — also advance the primary rent's `nextDueDate` once for
  // visibility, since the rent roll surfaces it. (Real rent JE rides through
  // recurringCharges for now; primaryRent is the "what the lease says" view.)
  if (
    lease.primaryRent?.nextDueDate &&
    lease.primaryRent.nextDueDate <= asOf
  ) {
    lease.primaryRent.nextDueDate = advance(
      lease.primaryRent.nextDueDate,
      lease.rentCycle,
    );
    if (posted.length === 0) await lease.save();
  }

  void DAY_MS;
  return NextResponse.json({
    ok: true,
    asOfDate: asOf.toISOString(),
    postedCount: posted.length,
    posted,
    skipped,
  });
}
