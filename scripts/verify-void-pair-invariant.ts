/**
 * READ-ONLY invariant check for the void/reversal fix.
 *
 * `ledgerVisibleMatch()` excludes any JE carrying `reversesJournalEntryId`, on
 * the assumption that such an entry is ALWAYS the reversal half of a voided
 * pair — i.e. its original exists, is Voided, and mirrors it exactly. If that
 * assumption were wrong anywhere, excluding the reversal alone would break the
 * netting in the opposite direction (an original still counted with nothing to
 * cancel it, or two rows both dropped when only one should be).
 *
 * Verifies, for every Posted reversal:
 *   1. the referenced original exists
 *   2. it is Voided        (else we'd now be dropping a live counterweight)
 *   3. it back-links here  (reversedByJournalEntryId round-trips)
 *   4. totals mirror       (reversal debits == original credits, and vice versa)
 *
 * Also reports Posted reversals pointing at a MISSING original — historical
 * strays from the old reverse+repost bill-edit path, which the read-layer fix
 * excludes anyway.
 *
 * Run from `site/`:  npx --yes tsx scripts/verify-void-pair-invariant.ts
 */
import dns from 'node:dns';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import mongoose, { Types } from 'mongoose';
import { connectToDatabase } from '../lib/db/mongoose';
import { JournalEntry } from '../lib/db/models/pm/JournalEntry';

function loadEnvLocal() {
  try {
    for (const line of readFileSync(resolve('.env.local'), 'utf8').split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && m[1] && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
    }
  } catch {
    /* optional in CI */
  }
}

interface JeLite {
  _id: Types.ObjectId;
  status: string;
  memo?: string;
  totalDebits: number;
  totalCredits: number;
  reversesJournalEntryId?: Types.ObjectId | null;
  reversedByJournalEntryId?: Types.ObjectId | null;
}

async function main() {
  loadEnvLocal();
  if (process.env.MONGODB_DNS_SERVERS) {
    dns.setServers(process.env.MONGODB_DNS_SERVERS.split(',').map((s) => s.trim()));
  }
  await connectToDatabase();
  console.log('connected (READ-ONLY)\n');

  const reversals = await JournalEntry.find({
    reversesJournalEntryId: { $ne: null },
  }).lean<JeLite[]>();

  const originals = await JournalEntry.find({
    _id: { $in: reversals.map((r) => r.reversesJournalEntryId as Types.ObjectId) },
  }).lean<JeLite[]>();
  const origById = new Map(originals.map((o) => [String(o._id), o]));

  let ok = 0;
  const problems: string[] = [];

  for (const rev of reversals) {
    const origId = String(rev.reversesJournalEntryId);
    const orig = origById.get(origId);
    const label = `${String(rev._id)} (${rev.memo ?? 'no memo'})`;

    if (!orig) {
      problems.push(`ORPHAN   ${label}\n           original ${origId} no longer exists`);
      continue;
    }
    if (orig.status !== 'Voided') {
      problems.push(
        `NOT VOID ${label}\n           original ${origId} is ${orig.status}, expected Voided`,
      );
      continue;
    }
    if (String(orig.reversedByJournalEntryId ?? '') !== String(rev._id)) {
      problems.push(
        `NO LINK  ${label}\n           original does not back-link to this reversal`,
      );
      continue;
    }
    if (
      rev.totalDebits !== orig.totalCredits ||
      rev.totalCredits !== orig.totalDebits
    ) {
      problems.push(
        `NOT MIRR ${label}\n           rev ${rev.totalDebits}/${rev.totalCredits} vs orig ${orig.totalDebits}/${orig.totalCredits}`,
      );
      continue;
    }
    ok++;
  }

  console.log(`${reversals.length} reversal entr${reversals.length === 1 ? 'y' : 'ies'} examined.`);
  console.log(`${ok} form a clean voided pair — safe to exclude as a unit.\n`);

  if (problems.length === 0) {
    console.log('INVARIANT HOLDS: every reversal has a Voided, mirrored original.');
    console.log('Excluding both halves nets to exactly zero in every case.');
  } else {
    console.log(`${problems.length} exception(s):\n`);
    for (const p of problems) console.log(`  ${p}\n`);
    console.log(
      'Orphans are historical strays from the old reverse+repost bill-edit path.\n' +
        'The read-layer fix excludes them too, so they stop distorting reports\n' +
        'without any data migration.',
    );
  }

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});
