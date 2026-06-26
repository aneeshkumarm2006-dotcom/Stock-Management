// POST /api/pm/leases/:id/post-recurring-charges
//
// Iterates `recurringCharges[]` on the lease, posts a JournalEntry per row
// whose `nextDate` is on or before `asOfDate` (defaults to now), and advances
// `nextDate` by the row's `frequency`. Each post hits `assertWriteAllowed`
// independently — locked periods block any due charge inside the window.
//
// This is the MANUAL sweep (the "Post recurring due now" button on the lease
// detail page). The automated nightly counterpart lives in
// `/api/cron/post-recurring-rent` → `runLeaseRecurringPoster`, which applies
// the same accounting and locked-period rules unattended.
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { z } from 'zod';
import { connectToDatabase } from '@/lib/db/mongoose';
import { Lease } from '@/lib/db/models/pm/Lease';
import { Property } from '@/lib/db/models/pm/Property';
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
import { buildRentChargeLines } from '@/lib/pm/rentCharge';
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

  // A recurring rent CHARGE is an accrual (the tenant now owes us), not a
  // cash receipt — cash arrives later when the payment is recorded. So the
  // debit leg is Accounts Receivable (asset), NOT Operating Cash. Resolve the
  // org's seeded `Accounts Receivable` default CoA (mirrors the A/P lookup in
  // postBillPaymentToLedger).
  const property = await Property.findOne({
    _id: lease.propertyId,
    organizationId: orgId,
  })
    .select({ propertyName: 1 })
    .lean<{
      _id: Types.ObjectId;
      propertyName: string;
    } | null>();
  if (!property) {
    return NextResponse.json({ error: 'Property missing' }, { status: 409 });
  }
  const arCoa = await ChartOfAccount.findOne({
    organizationId: orgId,
    defaultFor: 'Accounts Receivable',
    active: true,
  })
    .select({ _id: 1 })
    .lean<{ _id: Types.ObjectId } | null>();
  const accountsReceivableCoaId = arCoa?._id ?? null;
  if (!accountsReceivableCoaId) {
    return NextResponse.json(
      {
        error:
          'No Accounts Receivable chart-of-account configured; cannot post recurring charges.',
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
          accountId: accountsReceivableCoaId,
          scopeType: 'Property',
          scopeId: lease.propertyId,
          unitId: lease.unitId,
          description: 'Recurring rent receivable',
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
    // Persist the advanced nextDate ATOMICALLY with this charge's committed JE
    // before moving on. If a later iteration throws, the JEs already posted in
    // this run keep their advanced nextDate — a re-run cannot double-post them.
    // (Saving once after the whole loop meant a mid-loop throw left committed
    // JEs with un-advanced nextDates → double-posting on the next run.)
    await lease.save();
    posted.push({
      chargeId: String((charge as { _id?: unknown })._id ?? ''),
      amount: charge.amount,
      journalEntryId: String(je._id),
      newNextDate: newNext.toISOString(),
    });
  }

  // Primary rent (base + split recovery charges) is ITSELF a recurring charge,
  // driven off `primaryRent.nextDueDate` + the lease `rentCycle`. The rent
  // TERMS are the source of truth — there is no separate recurringCharges[] row
  // for base rent — so post one period here if due, mirroring the per-row sweep
  // above. (Previously this block only advanced the cursor cosmetically, so a
  // lease whose rent lived in primaryRent posted nothing → "Posted 0 charge(s)".)
  if (lease.primaryRent?.nextDueDate && lease.primaryRent.nextDueDate <= asOf) {
    const dueDate = lease.primaryRent.nextDueDate;
    let locked = false;
    try {
      await assertWriteAllowed({
        orgId: ctx.orgId,
        txnDate: dueDate,
        scopePropertyId: String(lease.propertyId),
        ctx,
      });
    } catch (err) {
      if (err instanceof LockedPeriodError) {
        locked = true;
        skipped.push({ chargeId: 'primary-rent', reason: err.policyMessage });
      } else {
        throw err;
      }
    }
    if (!locked) {
      const built = buildRentChargeLines(
        {
          primaryRent: lease.primaryRent,
          splitRentCharges: lease.splitRentCharges,
          propertyId: lease.propertyId,
          unitId: lease.unitId,
        },
        accountsReceivableCoaId,
      );
      if (built) {
        const je = await JournalEntry.create({
          organizationId: orgId,
          date: dueDate,
          scopeType: 'Property',
          scopeId: lease.propertyId,
          memo: `Rent charge for lease #${lease.leaseNumber}`,
          lines: built.lines,
          status: 'Posted',
          postedAt: new Date(),
          createdByUserId: new Types.ObjectId(ctx.userId),
        });
        const newNext = advance(dueDate, lease.rentCycle);
        lease.primaryRent.nextDueDate = newNext;
        // Persist the advanced cursor ATOMICALLY with its committed JE before
        // returning, so a re-run cannot double-post this period.
        await lease.save();
        posted.push({
          chargeId: 'primary-rent',
          amount: built.total,
          journalEntryId: String(je._id),
          newNextDate: newNext.toISOString(),
        });
      }
    }
  }

  if (posted.length > 0) {
    await logActivity({
      orgId: ctx.orgId,
      parentType: 'Lease',
      parentId: lease._id,
      eventType: 'Recurring charges posted',
      actorUserId: ctx.userId,
      payload: { count: posted.length, asOfDate: asOf.toISOString() },
    });
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
