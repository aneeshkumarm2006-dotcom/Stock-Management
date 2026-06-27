/**
 * One-shot repair: roll stranded rent-posting cursors forward to the present.
 *
 * `primaryRent.nextDueDate` (and each `recurringCharges[].nextDate`) is the
 * cursor the recurring-rent poster reads. It is seeded to the lease `startDate`
 * at creation and is only ever meant to move FORWARD as rent posts. A now-fixed
 * bug in the edit form rewound it to `startDate` on every save, so leases whose
 * rent lived in `primaryRent` were left with a cursor years in the past (e.g.
 * lease #8 started 2023-03-01 and its "Next due" was stuck at June 2023).
 *
 * This script REALIGNS each stale cursor forward to its next upcoming due date
 * — the first occurrence of the original schedule that is on/after today,
 * preserving the day-of-month and cycle phase. It does NOT post any journal
 * entries: the gap months are treated as already handled outside the system
 * (these are pre-existing/backdated leases), so no backdated A/R is accrued.
 * Going forward the poster advances the cursor one period at a time as rent
 * comes due, exactly as designed.
 *
 * Only cursors stranded in a PRIOR calendar year are realigned. A cursor
 * already in the current year is a normal pending posting (at most a few
 * periods behind) — the nightly cron posts those and advances them itself, so
 * realigning would wrongly skip a real, current charge. We touch only the
 * genuinely-stale ones.
 *
 * Scope: Active/Future leases only (Ended/Cancelled/Expired don't post). A
 * cursor in the current year (or future), or absent (null = no schedule), is
 * left untouched — so the script is idempotent and re-runs report 0 changes.
 *
 * Dates are stored at UTC midnight; advancement here is done with UTC setters
 * so the result is independent of the machine timezone.
 *
 * Run from `site/`:
 *   npx --yes tsx scripts/realign-lease-next-due-dates.ts --dry-run
 *   npx --yes tsx scripts/realign-lease-next-due-dates.ts
 */
import dns from 'node:dns';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import mongoose from 'mongoose';
import { connectToDatabase } from '../lib/db/mongoose';
import { Lease } from '../lib/db/models/pm/Lease';
import type { RentCycle } from '../types/pm';

function loadEnvLocal() {
  try {
    for (const line of readFileSync(resolve('.env.local'), 'utf8').split(
      /\r?\n/,
    )) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && m[1] && process.env[m[1]] === undefined) {
        process.env[m[1]] = m[2];
      }
    }
  } catch {
    // .env.local optional when running in CI
  }
}

/** Advance a UTC-midnight date by one rent cycle, using UTC setters so the
 *  result never drifts with the host timezone. Mirrors the cycle steps in
 *  `advanceRentDate` (leaseRecurringPoster.ts). */
function advanceUTC(current: Date, frequency: RentCycle): Date {
  const next = new Date(current);
  switch (frequency) {
    case 'Weekly':
      next.setUTCDate(next.getUTCDate() + 7);
      break;
    case 'Bi-weekly':
      next.setUTCDate(next.getUTCDate() + 14);
      break;
    case 'Monthly':
      next.setUTCMonth(next.getUTCMonth() + 1);
      break;
    case 'Quarterly':
      next.setUTCMonth(next.getUTCMonth() + 3);
      break;
    case 'Yearly':
      next.setUTCFullYear(next.getUTCFullYear() + 1);
      break;
  }
  return next;
}

/** First occurrence of `cursor`'s schedule that is on/after `floor`. Returns
 *  the same date when it is already on/after `floor` (idempotent). `null`
 *  means "couldn't make progress" — guards against an unknown cycle that
 *  would otherwise loop forever. */
function rollForward(
  cursor: Date,
  frequency: RentCycle,
  floor: Date,
): Date | null {
  let d = cursor;
  // 12,000 monthly steps ≈ 1,000 years — a safety cap, never reached in practice.
  for (let i = 0; i < 12_000 && d.getTime() < floor.getTime(); i++) {
    const next = advanceUTC(d, frequency);
    if (next.getTime() <= d.getTime()) return null; // no forward progress
    d = next;
  }
  return d.getTime() < floor.getTime() ? null : d;
}

async function main() {
  loadEnvLocal();
  const dryRun = process.argv.includes('--dry-run');

  // Windows/Node quirk: allow overriding the DNS resolver for mongodb+srv://
  // lookups without touching system DNS. No-op when unset.
  if (process.env.MONGODB_DNS_SERVERS) {
    dns.setServers(
      process.env.MONGODB_DNS_SERVERS.split(',').map((s) => s.trim()),
    );
  }

  await connectToDatabase();
  console.log(`✓ connected to Atlas${dryRun ? ' (dry-run)' : ''}`);

  // Today at UTC midnight — the floor a realigned cursor must reach.
  const now = new Date();
  const today = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );

  // A cursor counts as "stranded" only if it sits in a PRIOR calendar year.
  // Current-year cursors are normal pending postings — left for the cron.
  const isStranded = (d: Date): boolean =>
    d.getUTCFullYear() < now.getUTCFullYear();

  const leases = await Lease.find({
    status: { $in: ['Active', 'Future'] },
    $or: [
      { 'primaryRent.nextDueDate': { $ne: null } },
      { 'recurringCharges.0': { $exists: true } },
    ],
  });

  let changedLeases = 0;
  let changedCursors = 0;
  let skippedNoProgress = 0;

  for (const lease of leases) {
    const set: Record<string, Date> = {};

    // Base-rent cursor.
    const cur = lease.primaryRent?.nextDueDate;
    if (cur && isStranded(cur)) {
      const rolled = rollForward(cur, lease.rentCycle, today);
      if (rolled && rolled.getTime() !== cur.getTime()) {
        set['primaryRent.nextDueDate'] = rolled;
        console.log(
          `  lease #${lease.leaseNumber} base: ${cur
            .toISOString()
            .slice(0, 10)} → ${rolled.toISOString().slice(0, 10)}`,
        );
      } else if (!rolled) {
        skippedNoProgress++;
      }
    }

    // Extra recurring-charge rows (each carries its own frequency).
    lease.recurringCharges.forEach((charge, i) => {
      const cd = charge.nextDate;
      if (cd && isStranded(cd)) {
        const rolled = rollForward(cd, charge.frequency, today);
        if (rolled && rolled.getTime() !== cd.getTime()) {
          set[`recurringCharges.${i}.nextDate`] = rolled;
          console.log(
            `  lease #${lease.leaseNumber} charge[${i}]: ${cd
              .toISOString()
              .slice(0, 10)} → ${rolled.toISOString().slice(0, 10)}`,
          );
        } else if (!rolled) {
          skippedNoProgress++;
        }
      }
    });

    if (Object.keys(set).length === 0) continue;
    changedLeases++;
    changedCursors += Object.keys(set).length;

    if (!dryRun) {
      // updateOne with a targeted $set so we never re-run full-document
      // validation against legacy lease records.
      await Lease.collection.updateOne({ _id: lease._id }, { $set: set });
    }
  }

  console.log(
    `${dryRun ? 'Would realign' : 'Realigned'} ${changedCursors} cursor(s) ` +
      `across ${changedLeases} lease(s).` +
      (skippedNoProgress
        ? ` ${skippedNoProgress} skipped (unrecognized cycle).`
        : ''),
  );

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('Repair failed:', err);
  process.exitCode = 1;
});
