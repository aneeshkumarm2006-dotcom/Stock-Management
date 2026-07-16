/**
 * Backfill historical rent income (client Issue 3).
 *
 * The recurring-rent poster only posts going forward, so leases that pre-date
 * the client's first live posting run have no rent JEs for their earlier months
 * — the Financials (P&L) shows nothing for those periods. This script posts the
 * missing months, exactly like the poster would have, so historical periods
 * populate.
 *
 * For each Active/Future lease it walks month-by-month from a HORIZON (or the
 * lease start, whichever is later) up to the last completed month, and for any
 * month with NO existing rent JE for that lease it posts one accrual:
 *   DR Accounts Receivable  total
 *     CR base rent income   (+ recovery splits)
 * The amount is resolved AT that historical date, so a rent-escalation schedule
 * applies the period's correct rate.
 *
 * Safety:
 *  - Idempotent: a month that already has a "lease #N" rent/move-in JE is skipped.
 *  - Locked periods are respected (skipped + reported); nothing posts into a lock.
 *  - Dry-run by default. Requires --apply AND an explicit --horizon.
 *
 * Run from site/:
 *   npx --yes tsx scripts/backfill-historical-rent.ts --horizon=2025-01
 *   npx --yes tsx scripts/backfill-historical-rent.ts --horizon=2025-01 --apply
 */
import dns from 'node:dns';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import mongoose from 'mongoose';
import { connectToDatabase } from '../lib/db/mongoose';
import { Lease } from '../lib/db/models/pm/Lease';
import { ChartOfAccount } from '../lib/db/models/pm/ChartOfAccount';
import { JournalEntry } from '../lib/db/models/pm/JournalEntry';
import { resolveScheduledRentForDate } from '../lib/pm/rentSchedule';
import { buildRentChargeLines } from '../lib/pm/rentCharge';
import { assertWriteAllowed, LockedPeriodError } from '../lib/pm/lockedPeriod';
import type { PmContext } from '../lib/auth/getCurrentUser';

function loadEnvLocal() {
  try {
    for (const line of readFileSync(resolve('.env.local'), 'utf8').split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && m[1] && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
    }
  } catch {
    /* optional */
  }
}
const ORG_ID = '6a15a84e5bac3c1113395eb4';
const money = (c: number) => `$${(c / 100).toFixed(2)}`;
const ym = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;

async function main() {
  loadEnvLocal();
  const apply = process.argv.includes('--apply');
  const horizonArg = process.argv.find((a) => a.startsWith('--horizon='))?.split('=')[1];
  if (!horizonArg || !/^\d{4}-\d{2}$/.test(horizonArg)) {
    console.error('Pass --horizon=YYYY-MM (e.g. --horizon=2025-01).');
    process.exit(1);
  }
  const hy = Number(horizonArg.slice(0, 4));
  const hm = Number(horizonArg.slice(5, 7));
  const horizon = new Date(Date.UTC(hy, hm - 1, 1));

  if (process.env.MONGODB_DNS_SERVERS)
    dns.setServers(process.env.MONGODB_DNS_SERVERS.split(',').map((s) => s.trim()));
  await connectToDatabase();
  const orgId = new mongoose.Types.ObjectId(ORG_ID);
  console.log(`Mode: ${apply ? 'APPLY' : 'DRY-RUN'}  Horizon: ${horizonArg}\n`);

  const ar = await ChartOfAccount.findOne({
    organizationId: orgId,
    defaultFor: 'Accounts Receivable',
    active: true,
  })
    .select({ _id: 1 })
    .lean<{ _id: mongoose.Types.ObjectId } | null>();
  if (!ar) throw new Error('No Accounts Receivable chart-of-account configured.');

  // Existing rent-ish JEs, indexed by "leaseNumber|YYYY-MM" so we never double-post.
  const existing = await JournalEntry.find({
    organizationId: orgId,
    status: { $in: ['Posted', 'Draft'] },
    memo: /lease #\d+/i,
  })
    .select({ memo: 1, date: 1 })
    .lean<Array<{ memo?: string; date?: Date }>>();
  const seen = new Set<string>();
  for (const je of existing) {
    const n = je.memo?.match(/lease #(\d+)/i)?.[1];
    if (n && je.date) seen.add(`${n}|${ym(new Date(je.date))}`);
  }

  const systemCtx: PmContext = {
    userId: String(orgId),
    orgId: ORG_ID,
    roles: [],
    impersonatedBy: null,
  };

  const now = new Date();
  const endExcl = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)); // 1st of this month

  const leases = await Lease.find({
    organizationId: orgId,
    status: { $in: ['Active', 'Future'] },
  });

  let totalPosts = 0;
  let totalCents = 0;
  let lockedSkips = 0;

  for (const lease of leases) {
    if (!lease.startDate) continue;
    const startMonth = new Date(
      Date.UTC(lease.startDate.getUTCFullYear(), lease.startDate.getUTCMonth(), 1),
    );
    const from = startMonth > horizon ? startMonth : horizon;
    const day = lease.startDate.getUTCDate();

    let postsThisLease = 0;
    let centsThisLease = 0;
    const cur = new Date(from);
    while (cur < endExcl) {
      const key = `${lease.leaseNumber}|${ym(cur)}`;
      if (seen.has(key)) {
        cur.setUTCMonth(cur.getUTCMonth() + 1);
        continue;
      }
      // Date the charge on the lease's cycle day within this month (clamped).
      const dim = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 0)).getUTCDate();
      const postingDate = new Date(
        Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth(), Math.min(day, dim)),
      );

      const source = resolveScheduledRentForDate(lease, postingDate);
      const built = source ? buildRentChargeLines(source, ar._id) : null;
      if (!built) {
        cur.setUTCMonth(cur.getUTCMonth() + 1);
        continue;
      }

      // Respect locked periods — never post into a lock.
      let locked = false;
      try {
        await assertWriteAllowed({
          orgId: ORG_ID,
          txnDate: postingDate,
          scopePropertyId: String(lease.propertyId),
          ctx: systemCtx,
        });
      } catch (err) {
        if (err instanceof LockedPeriodError) {
          locked = true;
          lockedSkips++;
        } else throw err;
      }
      if (locked) {
        cur.setUTCMonth(cur.getUTCMonth() + 1);
        continue;
      }

      if (apply) {
        await JournalEntry.create({
          organizationId: orgId,
          date: postingDate,
          scopeType: 'Property',
          scopeId: lease.propertyId,
          memo: `Rent charge for lease #${lease.leaseNumber} (backfill)`,
          lines: built.lines,
          status: 'Posted',
          postedAt: new Date(),
          createdByUserId: orgId,
        });
      }
      seen.add(key);
      postsThisLease++;
      centsThisLease += built.total;
      cur.setUTCMonth(cur.getUTCMonth() + 1);
    }

    if (postsThisLease > 0) {
      totalPosts += postsThisLease;
      totalCents += centsThisLease;
      console.log(
        `  #${lease.leaseNumber}: ${postsThisLease} month(s), ${money(centsThisLease)} total`,
      );
    }
  }

  console.log(
    `\n${apply ? 'Posted' : 'Would post'} ${totalPosts} rent JE(s), ${money(totalCents)} total across ${leases.length} leases.` +
      (lockedSkips ? ` ${lockedSkips} month(s) skipped (locked period).` : ''),
  );
  await mongoose.disconnect();
}
main().catch((e) => {
  console.error('✗', e);
  process.exitCode = 1;
});
