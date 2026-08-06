/**
 * Repairs the missing August 2026 Tax Recovery accrual on leases #4, #14, #18.
 *
 * WHAT HAPPENED. Through July these three leases had no `rentSchedule`, so the
 * poster used the legacy `primaryRent`/`splitRentCharges` path and their Tax
 * Recovery split posted normally (JEs dated 2026-07-01). On Jul 27–29 a rent
 * schedule was entered on each lease with the Tax Recovery column left blank.
 * A non-empty schedule supersedes the legacy splits (see
 * `resolveScheduledRentForDate`), so the Aug 1 cron posted base + OPEX only.
 * The amounts were added to the schedule on Aug 4 — three days too late. The
 * cursor is already at 2026-09-01, so September onward is correct and only the
 * single August period is short.
 *
 * THE FIX. One correcting JE per lease dated 2026-08-01, built exactly as
 * `buildRentChargeLines` would have (DR Accounts Receivable / CR the term's tax
 * account, `scopeType: 'Property'` with scopeId + unitId) so it lands in the
 * right P&L cell AND in the AR-derived outstanding-balance rollup. The original
 * Aug 1 JE is left untouched — voiding and reposting would churn a period the
 * client has already reviewed.
 *
 * Amount and account come from the lease's OWN schedule period active on
 * 2026-08-01 — nothing is hardcoded, so the script cannot post a stale figure.
 *
 * Idempotent: skips a lease whose Aug 1 window already carries a posted Tax
 * Recovery credit (the original or a previous run of this script).
 *
 * Dry-run by default. Pass --commit to write.
 *   npx --yes tsx scripts/repair-august-tax-recovery.ts
 *   npx --yes tsx scripts/repair-august-tax-recovery.ts --commit
 */
import dns from 'node:dns';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import mongoose, { Types } from 'mongoose';
import { connectToDatabase } from '../lib/db/mongoose';
import { Lease } from '../lib/db/models/pm/Lease';
import { ChartOfAccount } from '../lib/db/models/pm/ChartOfAccount';
import { JournalEntry } from '../lib/db/models/pm/JournalEntry';
import { activeTermPeriodForDate } from '../lib/pm/rentSchedule';
import type { SchedulePeriod } from '../lib/pm/rentSchedule';

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
const LEASE_NUMBERS = [4, 14, 18];
/** The period the charge belongs to — UTC midnight, matching every other
 *  date-only field in the ledger. */
const PERIOD_DATE = new Date('2026-08-01T00:00:00.000Z');
const PERIOD_END = new Date('2026-08-02T00:00:00.000Z');
const COMMIT = process.argv.includes('--commit');
const money = (c: number) => `$${(c / 100).toFixed(2)}`;

async function main() {
  loadEnvLocal();
  const servers = process.env.MONGODB_DNS_SERVERS;
  if (servers) dns.setServers(servers.split(',').map((s) => s.trim()));
  await connectToDatabase();
  const orgObjectId = new Types.ObjectId(ORG_ID);

  console.log(`MODE: ${COMMIT ? 'COMMIT (writing)' : 'DRY RUN (no writes)'}`);
  console.log(`ORG:  ${ORG_ID}`);
  console.log(`PERIOD: ${PERIOD_DATE.toISOString().slice(0, 10)}\n`);

  const arCoa = await ChartOfAccount.findOne({
    organizationId: orgObjectId,
    defaultFor: 'Accounts Receivable',
    active: true,
  })
    .select({ _id: 1, name: 1 })
    .lean<{ _id: Types.ObjectId; name: string } | null>();
  if (!arCoa) {
    console.error('ABORT: no Accounts Receivable chart-of-account for this org.');
    await mongoose.disconnect();
    process.exit(1);
  }
  console.log(`A/R account: ${arCoa.name} (${arCoa._id})\n`);

  const leases = await Lease.find({
    organizationId: orgObjectId,
    leaseNumber: { $in: LEASE_NUMBERS },
  });

  let repaired = 0;
  let totalCents = 0;

  for (const num of LEASE_NUMBERS) {
    const lease = leases.find((l) => l.leaseNumber === num);
    if (!lease) {
      console.log(`#${num}: NOT FOUND in this org — skipped.`);
      continue;
    }
    console.log(`--- LEASE #${num} (${lease._id}) ---`);

    // The Term that governs the August period, per the lease's own schedule.
    const period = activeTermPeriodForDate(
      (lease.rentSchedule ?? []) as unknown as SchedulePeriod[],
      PERIOD_DATE,
    );
    if (!period) {
      console.log('  no active Term period on 2026-08-01 — skipped.\n');
      continue;
    }
    const taxCents = Math.round(period.taxMonthlyAmount || 0);
    if (taxCents <= 0 || !period.taxAccountId) {
      console.log(
        `  term "${period.label}" has no tax recovery to post (${money(
          taxCents,
        )}, account=${period.taxAccountId ?? 'none'}) — skipped.\n`,
      );
      continue;
    }
    console.log(
      `  term "${period.label}" → tax ${money(taxCents)} to account ${period.taxAccountId}`,
    );

    // Idempotency: has ANY posted JE in the Aug 1 window already credited this
    // tax account for this property? Covers both the original rent charge and a
    // prior run of this script.
    const existing = await JournalEntry.findOne({
      organizationId: orgObjectId,
      status: 'Posted',
      date: { $gte: PERIOD_DATE, $lt: PERIOD_END },
      lines: {
        $elemMatch: {
          accountId: period.taxAccountId,
          scopeId: lease.propertyId,
          credit: { $gt: 0 },
        },
      },
    })
      .select({ _id: 1, memo: 1 })
      .lean<{ _id: Types.ObjectId; memo?: string } | null>();
    if (existing) {
      console.log(
        `  ALREADY POSTED — JE ${existing._id} "${existing.memo ?? ''}" — skipped.\n`,
      );
      continue;
    }

    const lines = [
      {
        accountId: arCoa._id,
        scopeType: 'Property' as const,
        scopeId: lease.propertyId,
        unitId: lease.unitId,
        description: 'Rent receivable',
        debit: taxCents,
        credit: 0,
      },
      {
        accountId: period.taxAccountId,
        scopeType: 'Property' as const,
        scopeId: lease.propertyId,
        unitId: lease.unitId,
        description: `Tax Recovery — ${period.label}`,
        debit: 0,
        credit: taxCents,
      },
    ];
    const memo = `Tax Recovery correction for lease #${num} — August 2026`;

    console.log(`  JE: ${memo}`);
    for (const l of lines) {
      console.log(
        `      ${String(l.accountId)}  dr ${money(l.debit)}  cr ${money(l.credit)}  "${l.description}"`,
      );
    }

    if (COMMIT) {
      const je = await JournalEntry.create({
        organizationId: orgObjectId,
        date: PERIOD_DATE,
        scopeType: 'Property',
        scopeId: lease.propertyId,
        memo,
        lines,
        status: 'Posted',
        postedAt: new Date(),
        // System-originated, mirroring the cron poster which has no human actor.
        createdByUserId: orgObjectId,
      });
      console.log(`  WROTE JE ${je._id}`);
    }
    repaired += 1;
    totalCents += taxCents;
    console.log();
  }

  console.log('='.repeat(60));
  console.log(
    `${COMMIT ? 'Posted' : 'Would post'} ${repaired} correcting JE(s), total ${money(totalCents)}.`,
  );
  if (!COMMIT && repaired > 0) console.log('Re-run with --commit to write.');

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
