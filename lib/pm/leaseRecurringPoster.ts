// leaseRecurringPoster — worker that scans Active/Future leases and auto-posts
// the recurring rent CHARGE (an accrual: DR Accounts Receivable, CR the
// charge's income account) for every `recurringCharges[]` row that is due,
// then advances that row's `nextDate` by its `frequency`. This is the
// automated counterpart of the manual "Post recurring due now" button
// (POST /api/pm/leases/:id/post-recurring-charges) — same accounting, same
// locked-period rules, run unattended by the cron.
//
// A row is DUE when `today >= nextDate - postNDaysInAdvance` (the field exists
// precisely so the cron can post N days early; the manual button ignores it
// and posts only on/after nextDate). The JE is still dated at `nextDate` — the
// real due date — and the locked-period gate is checked at `nextDate` too.
//
// Concurrency (mirrors recurringPoster / DEL-003): each due row is CLAIMED
// with an atomic `findOneAndUpdate` that advances `recurringCharges.$.nextDate`
// guarded on the row's CURRENT nextDate. Two concurrent cron runs collapse to
// one post — only the run that wins the atomic claim writes the JE; the loser's
// guard no longer matches and it skips. One period is posted per row per run
// (matching the manual sweep); consecutive daily runs catch up any backlog.
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { Lease } from '@/lib/db/models/pm/Lease';
import { ChartOfAccount } from '@/lib/db/models/pm/ChartOfAccount';
import { JournalEntry } from '@/lib/db/models/pm/JournalEntry';
import { logActivity } from '@/lib/pm/activity';
import { assertWriteAllowed, LockedPeriodError } from '@/lib/pm/lockedPeriod';
import { buildRentChargeLines } from '@/lib/pm/rentCharge';
import type { PmContext } from '@/lib/auth/getCurrentUser';
import type { RentCycle } from '@/types/pm';

export function advanceRentDate(current: Date, frequency: RentCycle): Date {
  const next = new Date(current);
  switch (frequency) {
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

export interface LeasePostResult {
  leaseId: string;
  chargeId: string;
  posted: boolean;
  journalEntryId?: string;
  amount?: number;
  newNextDate?: string;
  note?: string;
}

function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

/**
 * Process due recurring rent charges for ONE organization and return per-row
 * results. Pass `now` to control "today" in tests.
 *
 * Tenant-scoped: every query is filtered by `organizationId` so a sweep can
 * never cross tenant boundaries (the cron loops over active orgs and calls
 * this once per org).
 */
export async function runLeaseRecurringPoster(
  orgId: string,
  now: Date = new Date(),
): Promise<LeasePostResult[]> {
  await connectToDatabase();
  if (!Types.ObjectId.isValid(orgId)) {
    throw new Error('runLeaseRecurringPoster requires a valid orgId.');
  }
  const orgObjectId = new Types.ObjectId(orgId);
  const today = startOfDay(now);

  // System context for the locked-period gate. A cron has no human roles, so
  // it can NEVER override a lock — locked periods hold against auto-posting.
  const systemCtx: PmContext = {
    userId: String(orgObjectId),
    orgId,
    roles: [],
    impersonatedBy: null,
  };

  // A recurring rent charge is an accrual — the debit leg is Accounts
  // Receivable. Resolve the org's seeded A/R default once; if it's missing we
  // can't post anything for this org.
  const arCoa = await ChartOfAccount.findOne({
    organizationId: orgObjectId,
    defaultFor: 'Accounts Receivable',
    active: true,
  })
    .select({ _id: 1 })
    .lean<{ _id: Types.ObjectId } | null>();
  if (!arCoa) {
    return [
      {
        leaseId: '',
        chargeId: '',
        posted: false,
        note: 'No Accounts Receivable chart-of-account configured; skipped org.',
      },
    ];
  }
  const accountsReceivableCoaId = arCoa._id;

  // Candidates: any Active/Future lease with EITHER a recurringCharges[] row OR
  // a primary-rent schedule cursor. (The old filter required a recurringCharges
  // row, so a lease whose rent lived only in primaryRent was never swept.)
  const leases = await Lease.find({
    organizationId: orgObjectId,
    status: { $in: ['Active', 'Future'] },
    $or: [
      { 'recurringCharges.0': { $exists: true } },
      { 'primaryRent.nextDueDate': { $ne: null } },
    ],
  });

  const results: LeasePostResult[] = [];
  for (const lease of leases) {
    let postedThisLease = 0;

    for (const charge of lease.recurringCharges) {
      const chargeId = String((charge as { _id?: unknown })._id ?? '');
      if (!charge.nextDate) continue; // no schedule on this row

      // DUE when today has reached the post-in-advance window. JE/lock still
      // use the real nextDate.
      const trigger = startOfDay(charge.nextDate);
      trigger.setDate(trigger.getDate() - (charge.postNDaysInAdvance ?? 0));
      if (today < trigger) {
        results.push({
          leaseId: String(lease._id),
          chargeId,
          posted: false,
          note: 'Not yet due',
        });
        continue;
      }

      // Locked-period gate — block posting into a locked accounting period.
      try {
        await assertWriteAllowed({
          orgId,
          txnDate: charge.nextDate,
          scopePropertyId: String(lease.propertyId),
          ctx: systemCtx,
        });
      } catch (err) {
        if (err instanceof LockedPeriodError) {
          results.push({
            leaseId: String(lease._id),
            chargeId,
            posted: false,
            note: `Locked period: ${err.policyMessage}`,
          });
          continue;
        }
        throw err;
      }

      // Atomically CLAIM this row's nextDate before posting. The $elemMatch
      // guard pins the row by _id AND its current nextDate, so only one racer
      // matches; the positional `$` advances that same row.
      const originalNextDate = charge.nextDate;
      const claimedNextDate = advanceRentDate(originalNextDate, charge.frequency);
      const claim = await Lease.findOneAndUpdate(
        {
          _id: lease._id,
          organizationId: orgObjectId,
          recurringCharges: {
            $elemMatch: {
              _id: (charge as { _id?: Types.ObjectId })._id,
              nextDate: originalNextDate,
            },
          },
        },
        { $set: { 'recurringCharges.$.nextDate': claimedNextDate } },
        { new: false },
      );
      if (!claim) {
        results.push({
          leaseId: String(lease._id),
          chargeId,
          posted: false,
          note: 'Already claimed by a concurrent run',
        });
        continue;
      }

      try {
        const je = await JournalEntry.create({
          organizationId: orgObjectId,
          date: originalNextDate,
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
          postedAt: new Date(now),
          // No human actor — attribute to the org's system id (mirrors the
          // systemCtx used for the locked-period gate).
          createdByUserId: orgObjectId,
        });
        postedThisLease += 1;
        results.push({
          leaseId: String(lease._id),
          chargeId,
          posted: true,
          journalEntryId: String(je._id),
          amount: charge.amount,
          newNextDate: claimedNextDate.toISOString(),
        });
      } catch (err) {
        // Posting failed after the claim — roll the row's nextDate back so it
        // re-fires next run rather than silently skipping a period.
        await Lease.updateOne(
          {
            _id: lease._id,
            organizationId: orgObjectId,
            recurringCharges: {
              $elemMatch: {
                _id: (charge as { _id?: Types.ObjectId })._id,
                nextDate: claimedNextDate,
              },
            },
          },
          { $set: { 'recurringCharges.$.nextDate': originalNextDate } },
        );
        results.push({
          leaseId: String(lease._id),
          chargeId,
          posted: false,
          note: err instanceof Error ? err.message : 'Posting failed',
        });
      }
    }

    // Primary rent (base + split recovery charges) is itself a recurring charge,
    // driven off `primaryRent.nextDueDate` + the lease `rentCycle`. Post one
    // period per run with the SAME atomic-claim discipline as the rows above so
    // concurrent runs collapse to a single post. (Previously this only advanced
    // the cursor cosmetically, so leases whose rent lived in primaryRent never
    // posted a JE.) Primary rent has no postNDaysInAdvance — it posts on/after
    // the real due date, matching the manual sweep.
    if (
      lease.primaryRent?.nextDueDate &&
      startOfDay(lease.primaryRent.nextDueDate) <= today
    ) {
      const dueDate = lease.primaryRent.nextDueDate;
      let locked = false;
      try {
        await assertWriteAllowed({
          orgId,
          txnDate: dueDate,
          scopePropertyId: String(lease.propertyId),
          ctx: systemCtx,
        });
      } catch (err) {
        if (err instanceof LockedPeriodError) {
          locked = true;
          results.push({
            leaseId: String(lease._id),
            chargeId: 'primary-rent',
            posted: false,
            note: `Locked period: ${err.policyMessage}`,
          });
        } else {
          throw err;
        }
      }

      if (!locked) {
        const claimedNext = advanceRentDate(dueDate, lease.rentCycle);
        const claim = await Lease.findOneAndUpdate(
          {
            _id: lease._id,
            organizationId: orgObjectId,
            'primaryRent.nextDueDate': dueDate,
          },
          { $set: { 'primaryRent.nextDueDate': claimedNext } },
          { new: false },
        );
        if (!claim) {
          results.push({
            leaseId: String(lease._id),
            chargeId: 'primary-rent',
            posted: false,
            note: 'Already claimed by a concurrent run',
          });
        } else {
          const built = buildRentChargeLines(
            {
              primaryRent: lease.primaryRent,
              splitRentCharges: lease.splitRentCharges,
              propertyId: lease.propertyId,
              unitId: lease.unitId,
            },
            accountsReceivableCoaId,
          );
          if (!built) {
            // Nothing to post (0 rent) — release the claim so the cursor holds.
            await Lease.updateOne(
              {
                _id: lease._id,
                organizationId: orgObjectId,
                'primaryRent.nextDueDate': claimedNext,
              },
              { $set: { 'primaryRent.nextDueDate': dueDate } },
            );
          } else {
            try {
              const je = await JournalEntry.create({
                organizationId: orgObjectId,
                date: dueDate,
                scopeType: 'Property',
                scopeId: lease.propertyId,
                memo: `Rent charge for lease #${lease.leaseNumber}`,
                lines: built.lines,
                status: 'Posted',
                postedAt: new Date(now),
                createdByUserId: orgObjectId,
              });
              postedThisLease += 1;
              results.push({
                leaseId: String(lease._id),
                chargeId: 'primary-rent',
                posted: true,
                journalEntryId: String(je._id),
                amount: built.total,
                newNextDate: claimedNext.toISOString(),
              });
            } catch (err) {
              // Posting failed after the claim — roll the cursor back so it
              // re-fires next run rather than silently skipping a period.
              await Lease.updateOne(
                {
                  _id: lease._id,
                  organizationId: orgObjectId,
                  'primaryRent.nextDueDate': claimedNext,
                },
                { $set: { 'primaryRent.nextDueDate': dueDate } },
              );
              results.push({
                leaseId: String(lease._id),
                chargeId: 'primary-rent',
                posted: false,
                note: err instanceof Error ? err.message : 'Posting failed',
              });
            }
          }
        }
      }
    }

    if (postedThisLease > 0) {
      await logActivity({
        orgId,
        parentType: 'Lease',
        parentId: lease._id,
        eventType: 'Recurring charges posted',
        actorUserId: null, // system-originated (cron) — no human actor
        payload: { count: postedThisLease, source: 'cron', asOfDate: today.toISOString() },
      });
    }
  }
  return results;
}
