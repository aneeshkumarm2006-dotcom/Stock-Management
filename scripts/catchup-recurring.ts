/**
 * Catch up recurring transactions through a given date.
 *
 * The poster advances one period per run, so a rule whose cursor has fallen
 * behind needs one cron run per missed period. This walks each rule forward
 * through every missed period in one go — the operational tool for the
 * "post Jan–Jul without keying them in" job.
 *
 * Delegates to the SAME runRecurringPoster / planRecurringCatchUp the UI's
 * "Catch up…" button calls, so the two can never drift.
 *
 * Safety:
 *  - Dry-run by default; --apply is required to write.
 *  - The dry run reports locked periods, possible duplicates against
 *    manually-entered records, and the grand total.
 *  - Idempotent three ways over: the atomic claim, a partial unique index on
 *    (organizationId, recurringTransactionId, recurringPeriodDate), and the
 *    duplicate scan. Re-running after a successful apply posts nothing.
 *  - --apply runs with the FinancialAdministrator role so it CAN post into a
 *    locked period. Review the dry run's `locked` rows first; that override is
 *    the whole reason a backfill into a closed month works at all.
 *
 * Run from site/:
 *   npx --yes tsx scripts/catchup-recurring.ts --through=2026-07-31
 *   npx --yes tsx scripts/catchup-recurring.ts --through=2026-07-31 --apply
 */
import dns from 'node:dns';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import mongoose from 'mongoose';
import { connectToDatabase } from '../lib/db/mongoose';
import {
  planRecurringCatchUp,
  runRecurringPoster,
} from '../lib/pm/recurringPoster';
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
const day = (d: string | Date) => new Date(d).toISOString().slice(0, 10);

async function main() {
  loadEnvLocal();
  const apply = process.argv.includes('--apply');
  const throughArg = process.argv
    .find((a) => a.startsWith('--through='))
    ?.split('=')[1];
  if (!throughArg || !/^\d{4}-\d{2}-\d{2}$/.test(throughArg)) {
    console.error('Pass --through=YYYY-MM-DD (e.g. --through=2026-07-31).');
    process.exit(1);
  }
  const throughDate = new Date(`${throughArg}T23:59:59.999Z`);
  if (Number.isNaN(throughDate.getTime())) {
    console.error(`Invalid --through date: ${throughArg}`);
    process.exit(1);
  }
  if (throughDate > new Date()) {
    console.error('--through cannot be in the future.');
    process.exit(1);
  }

  if (process.env.MONGODB_DNS_SERVERS) {
    dns.setServers(
      process.env.MONGODB_DNS_SERVERS.split(',').map((s) => s.trim()),
    );
  }
  await connectToDatabase();
  console.log(
    `Mode: ${apply ? 'APPLY' : 'DRY-RUN'}  Through: ${throughArg}  Org: ${ORG_ID}\n`,
  );

  // Always plan first, even on --apply, so the transcript records what was
  // about to happen next to what actually did.
  const plan = await planRecurringCatchUp(ORG_ID, throughDate);
  if (plan.plan.length === 0) {
    console.log('Nothing due through that date — everything is up to date.');
    await mongoose.disconnect();
    return;
  }

  console.log('PLAN');
  console.log('-'.repeat(96));
  for (const row of plan.plan) {
    const scopes = row.scopes.map((s) => s.propertyName).join(', ');
    const flag =
      row.status === 'will-post' ? '' : `  <-- ${row.status.toUpperCase()}`;
    console.log(
      `${day(row.periodDate)}  ${row.type.padEnd(14)}  ${money(row.amountCents).padStart(12)}  ${scopes}${flag}`,
    );
    if (row.note) console.log(`             ${row.note}`);
  }
  console.log('-'.repeat(96));
  console.log(
    `${plan.totals.periods} periods across ${plan.totals.rules} rules, total ${money(plan.totals.cents)}` +
      (plan.totals.blocked > 0 ? `, ${plan.totals.blocked} BLOCKED` : ''),
  );

  if (!apply) {
    console.log('\nDry run — nothing was written. Re-run with --apply to post.');
    await mongoose.disconnect();
    return;
  }

  // The role is what lets a backfill write into a closed period; see
  // assertWriteAllowed, which short-circuits on role before querying policies.
  const actorCtx: PmContext = {
    userId: ORG_ID,
    orgId: ORG_ID,
    roles: ['FinancialAdministrator'],
    impersonatedBy: null,
  };

  console.log('\nAPPLYING…');
  const results = await runRecurringPoster(ORG_ID, new Date(), {
    throughDate,
    actorCtx,
  });

  const posted = results.filter((r) => r.posted);
  const skipped = results.filter((r) => !r.posted);
  console.log('-'.repeat(96));
  for (const r of posted) {
    console.log(
      `POSTED  ${r.periodDate ? day(r.periodDate) : '—'}  ${r.artifactKind}  ${(r.artifactIds ?? []).join(', ')}`,
    );
  }
  for (const r of skipped) {
    console.log(
      `SKIP    ${r.periodDate ? day(r.periodDate) : '—'}  rule ${r.recurringTransactionId}  ${r.note ?? ''}`,
    );
  }
  console.log('-'.repeat(96));
  console.log(`Posted ${posted.length}, skipped ${skipped.length}.`);
  console.log(
    '\nNow re-run WITHOUT --apply to prove idempotency: the plan must come back empty.',
  );

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
