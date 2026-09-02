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
import { Types } from "mongoose";
import { connectToDatabase } from "@/lib/db/mongoose";
import { Lease } from "@/lib/db/models/pm/Lease";
import { ChartOfAccount } from "@/lib/db/models/pm/ChartOfAccount";
import { JournalEntry } from "@/lib/db/models/pm/JournalEntry";
import { logActivity } from "@/lib/pm/activity";
import { assertWriteAllowed, LockedPeriodError } from "@/lib/pm/lockedPeriod";
import { buildRentChargeLines } from "@/lib/pm/rentCharge";
import {
  leaseTenantsLabel,
  recurringChargeMemo,
  rentChargeMemo,
} from "@/lib/pm/journalMemo";
import { resolveScheduledRentForDate } from "@/lib/pm/rentSchedule";
import type { PmContext } from "@/lib/auth/getCurrentUser";
import type { RentCycle } from "@/types/pm";

/**
 * Advance a rent cursor by one cycle.
 *
 * UTC arithmetic, and CLAMPED to the target month's length.
 *
 * The previous implementation used local getters/setters on a date that is
 * stored at UTC midnight, so on any host west of GMT `2026-07-01T00:00Z` + 1
 * month resolved to `2026-07-31T00:00Z` — the cursor walked to the last day of
 * the same month instead of the first of the next one. Vercel runs UTC so
 * production was spared, but every script and dev run was not.
 *
 * It also had no month-length clamp, which is a bug on EVERY host: a lease
 * anchored on the 31st resolved Jan 31 + 1 month to Mar 3 (JS rolls the
 * overflow forward), silently skipping February for the life of the lease.
 * Clamping to Feb 28 matches `addMonthsClamped` in lib/pm/recurringPoster.ts.
 *
 * Like `addMonthsClamped`, the anchor is read from `current`, so a cursor that
 * has ALREADY been clamped stays on the shorter day (Jan 31 → Feb 28 → Mar 28).
 * Recovering the original anchor would need the lease start date, which callers
 * do not pass; the two engines drift identically, which is what matters.
 */
export function advanceRentDate(current: Date, frequency: RentCycle): Date {
  switch (frequency) {
    case "Weekly":
      return addUtcDays(current, 7);
    case "Bi-weekly":
      return addUtcDays(current, 14);
    case "Monthly":
      return addUtcMonths(current, 1);
    case "Quarterly":
      return addUtcMonths(current, 3);
    case "Yearly":
      // Via months, not setFullYear, so Feb 29 clamps to Feb 28 rather than
      // rolling into March.
      return addUtcMonths(current, 12);
  }
}

function addUtcDays(current: Date, days: number): Date {
  return new Date(current.getTime() + days * 24 * 60 * 60 * 1000);
}

/** Days in the UTC month `monthsAhead` after `current`. */
function daysInUtcMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

function addUtcMonths(current: Date, months: number): Date {
  const anchorDay = current.getUTCDate();
  const targetMonthStart = new Date(
    Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + months, 1),
  );
  const y = targetMonthStart.getUTCFullYear();
  const m = targetMonthStart.getUTCMonth();
  return new Date(Date.UTC(y, m, Math.min(anchorDay, daysInUtcMonth(y, m))));
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
    throw new Error("runLeaseRecurringPoster requires a valid orgId.");
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
    defaultFor: "Accounts Receivable",
    active: true,
  })
    .select({ _id: 1 })
    .lean<{ _id: Types.ObjectId } | null>();
  if (!arCoa) {
    return [
      {
        leaseId: "",
        chargeId: "",
        posted: false,
        note: "No Accounts Receivable chart-of-account configured; skipped org.",
      },
    ];
  }
  const accountsReceivableCoaId = arCoa._id;

  // Candidates: any Active/Future lease with EITHER a recurringCharges[] row OR
  // a primary-rent schedule cursor. (The old filter required a recurringCharges
  // row, so a lease whose rent lived only in primaryRent was never swept.)
  const leases = await Lease.find({
    organizationId: orgObjectId,
    status: { $in: ["Active", "Future"] },
    $or: [
      { "recurringCharges.0": { $exists: true } },
      { "primaryRent.nextDueDate": { $ne: null } },
    ],
  });

  const results: LeasePostResult[] = [];
  for (const lease of leases) {
    let postedThisLease = 0;
    // Resolved once per lease — every JE this iteration posts carries the
    // same tenant label, and `lease.tenants[]` is already in memory.
    const tenantLabel = leaseTenantsLabel(lease.tenants);

    for (const charge of lease.recurringCharges) {
      const chargeId = String((charge as { _id?: unknown })._id ?? "");
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
          note: "Not yet due",
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
      const claimedNextDate = advanceRentDate(
        originalNextDate,
        charge.frequency,
      );
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
        { $set: { "recurringCharges.$.nextDate": claimedNextDate } },
        { new: false },
      );
      if (!claim) {
        results.push({
          leaseId: String(lease._id),
          chargeId,
          posted: false,
          note: "Already claimed by a concurrent run",
        });
        continue;
      }

      try {
        const je = await JournalEntry.create({
          organizationId: orgObjectId,
          date: originalNextDate,
          scopeType: "Property",
          scopeId: lease.propertyId,
          memo: recurringChargeMemo({
            leaseNumber: lease.leaseNumber,
            tenantLabel,
            detail: charge.memo ?? charge.frequency,
          }),
          lines: [
            {
              accountId: accountsReceivableCoaId,
              scopeType: "Property",
              scopeId: lease.propertyId,
              unitId: lease.unitId,
              description: "Recurring rent receivable",
              debit: charge.amount,
              credit: 0,
            },
            {
              accountId: charge.accountId,
              scopeType: "Property",
              scopeId: lease.propertyId,
              unitId: lease.unitId,
              description: "Recurring rent income",
              debit: 0,
              credit: charge.amount,
            },
          ],
          status: "Posted",
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
          { $set: { "recurringCharges.$.nextDate": originalNextDate } },
        );
        results.push({
          leaseId: String(lease._id),
          chargeId,
          posted: false,
          note: err instanceof Error ? err.message : "Posting failed",
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
            chargeId: "primary-rent",
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
            "primaryRent.nextDueDate": dueDate,
          },
          { $set: { "primaryRent.nextDueDate": claimedNext } },
          { new: false },
        );
        if (!claim) {
          results.push({
            leaseId: String(lease._id),
            chargeId: "primary-rent",
            posted: false,
            note: "Already claimed by a concurrent run",
          });
        } else {
          // Resolve the rent for THIS due date. With a rent schedule, the
          // active Term period drives the charge (escalations auto-apply by
          // date); without one, this is the legacy primaryRent/splitRentCharges.
          const source = resolveScheduledRentForDate(lease, dueDate);
          const built = source
            ? buildRentChargeLines(source, accountsReceivableCoaId)
            : null;
          if (!built) {
            // Nothing to post (0 rent, or schedule has no active Term at the due
            // date) — release the claim so the cursor holds.
            await Lease.updateOne(
              {
                _id: lease._id,
                organizationId: orgObjectId,
                "primaryRent.nextDueDate": claimedNext,
              },
              { $set: { "primaryRent.nextDueDate": dueDate } },
            );
          } else {
            try {
              const je = await JournalEntry.create({
                organizationId: orgObjectId,
                date: dueDate,
                scopeType: "Property",
                scopeId: lease.propertyId,
                memo: rentChargeMemo({
                  leaseNumber: lease.leaseNumber,
                  tenantLabel,
                }),
                lines: built.lines,
                status: "Posted",
                postedAt: new Date(now),
                createdByUserId: orgObjectId,
              });
              postedThisLease += 1;
              results.push({
                leaseId: String(lease._id),
                chargeId: "primary-rent",
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
                  "primaryRent.nextDueDate": claimedNext,
                },
                { $set: { "primaryRent.nextDueDate": dueDate } },
              );
              results.push({
                leaseId: String(lease._id),
                chargeId: "primary-rent",
                posted: false,
                note: err instanceof Error ? err.message : "Posting failed",
              });
            }
          }
        }
      }
    }

    if (postedThisLease > 0) {
      await logActivity({
        orgId,
        parentType: "Lease",
        parentId: lease._id,
        eventType: "Recurring charges posted",
        actorUserId: null, // system-originated (cron) — no human actor
        payload: {
          count: postedThisLease,
          source: "cron",
          asOfDate: today.toISOString(),
        },
      });
    }
  }
  return results;
}
