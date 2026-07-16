/**
 * Correct the duplicated FIRST-month rent (client Issue 2).
 *
 * When a draft lease is executed, the move-in JE records the first month's rent
 * as income AND the recurring-rent poster posted that same month (its cursor was
 * seeded to the lease start). Result: the first month's Base Rent income is
 * counted twice (client saw a $12,250 lease report as $24,500).
 *
 * This VOIDS the duplicate — the recurring "Rent charge for lease #N" JE that
 * lands in the same month as the lease's "Move-in JE". A bare status->Voided
 * (no reversing entry) is deliberate: the P&L matrix sums Posted JEs and EXCLUDES
 * Voided, so voiding removes exactly one copy and leaves the move-in JE as the
 * month's single rent income. (A paired reversal would over-correct to $0,
 * because the matrix counts the Posted reversal while excluding the Voided
 * original.) The going-forward code fix in leasingPromotion.ts prevents new
 * doubles by advancing the cursor past the move-in month.
 *
 * Idempotent: an already-Voided duplicate is skipped. Dry-run by default.
 *
 * Run from site/:
 *   npx --yes tsx scripts/fix-duplicate-firstmonth-rent.ts            # preview
 *   npx --yes tsx scripts/fix-duplicate-firstmonth-rent.ts --apply    # execute
 */
import dns from 'node:dns';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import mongoose from 'mongoose';
import { connectToDatabase } from '../lib/db/mongoose';

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
// The signed-in PM (LISA CONG) — recorded as the actor who voided the entry.
const VOIDED_BY_USER_ID = '6a15a84d5bac3c1113395eae';
const money = (c: number) => `$${(c / 100).toFixed(2)}`;
const ym = (x: unknown) => (x ? new Date(x as string).toISOString().slice(0, 7) : '—');

interface JeLine { accountId?: unknown; debit?: number; credit?: number }
interface Je { _id: unknown; date?: unknown; status?: string; memo?: string; lines?: JeLine[] }

async function main() {
  loadEnvLocal();
  const apply = process.argv.includes('--apply');
  if (process.env.MONGODB_DNS_SERVERS)
    dns.setServers(process.env.MONGODB_DNS_SERVERS.split(',').map((s) => s.trim()));
  await connectToDatabase();
  const db = mongoose.connection.db;
  if (!db) throw new Error('no db handle');
  const orgId = new mongoose.Types.ObjectId(ORG_ID);
  console.log(`Mode: ${apply ? 'APPLY' : 'DRY-RUN (pass --apply to execute)'}\n`);

  const incomeCoas = await db
    .collection('pm_chart_of_accounts')
    .find({ organizationId: orgId, type: 'Income' })
    .toArray();
  const incomeIds = new Set(incomeCoas.map((c) => String(c._id)));

  const posted = (await db
    .collection('pm_journal_entries')
    .find({ organizationId: orgId, status: 'Posted' })
    .toArray()) as unknown as Je[];

  const incomeOf = (j: Je) =>
    (j.lines ?? [])
      .filter((l) => incomeIds.has(String(l.accountId)))
      .reduce((s, l) => s + ((l.credit ?? 0) - (l.debit ?? 0)), 0);

  const moveIns = posted.filter((j) => /^Move-in JE for lease #(\d+)/.test(j.memo ?? ''));
  const toVoid: Je[] = [];
  for (const mi of moveIns) {
    const num = (mi.memo ?? '').match(/lease #(\d+)/)?.[1];
    if (!num || incomeOf(mi) <= 0) continue;
    const dup = posted.find(
      (j) =>
        j !== mi &&
        new RegExp(`^Rent charge for lease #${num}\\b`).test(j.memo ?? '') &&
        ym(j.date) === ym(mi.date) &&
        incomeOf(j) > 0,
    );
    if (dup) {
      console.log(
        `Lease #${num} ${ym(mi.date)}: keep move-in ${money(incomeOf(mi))} (${String(mi._id)}), VOID recurring ${money(incomeOf(dup))} (${String(dup._id)})`,
      );
      toVoid.push(dup);
    }
  }

  if (toVoid.length === 0) {
    console.log('No un-voided duplicates found — nothing to do.');
    await mongoose.disconnect();
    return;
  }

  if (apply) {
    for (const dup of toVoid) {
      await db.collection('pm_journal_entries').updateOne(
        { _id: dup._id as mongoose.Types.ObjectId, organizationId: orgId, status: 'Posted' },
        {
          $set: {
            status: 'Voided',
            voidedAt: new Date(),
            voidedByUserId: new mongoose.Types.ObjectId(VOIDED_BY_USER_ID),
            memo: `${dup.memo} (voided: duplicate of move-in first-month rent)`,
          },
        },
      );
    }
    console.log(`\n✓ Voided ${toVoid.length} duplicate JE(s).`);
  } else {
    console.log(`\nWould void ${toVoid.length} duplicate JE(s). Re-run with --apply.`);
  }

  await mongoose.disconnect();
}
main().catch((e) => {
  console.error('✗', e);
  process.exitCode = 1;
});
