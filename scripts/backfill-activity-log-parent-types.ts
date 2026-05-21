/**
 * One-shot housekeeping migration after Phase 2.
 *
 * Phase 1 mutating routes (chart-of-accounts, bank-accounts) wrote activity
 * log rows with `parentType: 'Task'` as a placeholder because the real
 * accounting parent types weren't in the PARENT_TYPES enum yet. Phase 2
 * added them, but the historical rows still point at Task — which means a
 * Task detail page would surface "Bank account created" entries on its
 * Event history tab. This script fixes the historical rows in place.
 *
 * The match is by eventType prefix (a stable string the route hard-codes),
 * so re-running it is safe: rows already correctly typed won't match
 * because their parentType already differs (no $set needed) — but the
 * filter intentionally still includes parentType:'Task' so well-typed
 * future rows can't be clobbered.
 *
 * Run from `site/`:
 *   npx --yes tsx scripts/backfill-activity-log-parent-types.ts
 *   npx --yes tsx scripts/backfill-activity-log-parent-types.ts --dry-run
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import mongoose from 'mongoose';
import { connectToDatabase } from '../lib/db/mongoose';
import { ActivityLogEntry } from '../lib/db/models/pm/ActivityLogEntry';

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

interface Rule {
  /** Substring (case-sensitive) that uniquely identifies the eventType. */
  eventTypeContains: string;
  newParentType:
    | 'BankAccount'
    | 'ChartOfAccount'
    | 'JournalEntry'
    | 'Deposit'
    | 'LockedPeriodPolicy'
    | 'CompanyAccount';
}

const RULES: Rule[] = [
  { eventTypeContains: 'Bank account', newParentType: 'BankAccount' },
  { eventTypeContains: 'Chart of account', newParentType: 'ChartOfAccount' },
  // JE/Deposit/LockedPeriod/CompanyAccount routes were authored from Phase 2
  // onward with the correct parentType, so they shouldn't need backfill —
  // but include them for safety in case anything was hand-edited.
  { eventTypeContains: 'JournalEntry', newParentType: 'JournalEntry' },
  { eventTypeContains: 'Deposit', newParentType: 'Deposit' },
  { eventTypeContains: 'Locked period', newParentType: 'LockedPeriodPolicy' },
  { eventTypeContains: 'Company account', newParentType: 'CompanyAccount' },
];

async function main() {
  loadEnvLocal();
  const dryRun = process.argv.includes('--dry-run');

  await connectToDatabase();
  console.log(`✓ connected to Atlas${dryRun ? ' (dry-run)' : ''}`);

  let total = 0;
  for (const rule of RULES) {
    const filter = {
      parentType: 'Task' as const,
      eventType: { $regex: rule.eventTypeContains, $options: '' },
    };
    const matchCount = await ActivityLogEntry.countDocuments(filter);
    if (matchCount === 0) {
      console.log(
        `  ${rule.eventTypeContains.padEnd(22)} → ${rule.newParentType.padEnd(20)}  (0 rows)`,
      );
      continue;
    }
    if (dryRun) {
      console.log(
        `  ${rule.eventTypeContains.padEnd(22)} → ${rule.newParentType.padEnd(20)}  (${matchCount} rows, dry-run)`,
      );
      total += matchCount;
      continue;
    }
    // ActivityLogEntry is append-only (pre-save guard rejects re-saves),
    // so go through Collection.updateMany to bypass Mongoose hooks for
    // this surgical fix.
    const res = await ActivityLogEntry.collection.updateMany(filter, {
      $set: { parentType: rule.newParentType },
    });
    console.log(
      `  ${rule.eventTypeContains.padEnd(22)} → ${rule.newParentType.padEnd(20)}  (${res.modifiedCount} rows updated)`,
    );
    total += res.modifiedCount;
  }

  console.log(`\n${dryRun ? 'Would update' : 'Updated'} ${total} row${total === 1 ? '' : 's'}.`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exitCode = 1;
});
