/**
 * Cleanup for the test data created while producing the recurring-transactions
 * guide (screenshots run as lisa@ramcodev.com on 2026-08-04).
 *
 * Deletes ONLY the throwaway rule created for the catch-up preview screenshot,
 * matched on its deliberately unmistakable memo:
 *   - RecurringTransaction "zzGUIDE TEST - DELETE ME"
 *   - Any ActivityLogEntry rows whose parentId is that rule
 *
 * The rule was only ever PREVIEWED (dry run, read-only) — never posted — so it
 * has no Bills, no JournalEntries and no ledger footprint. This asserts that
 * before deleting, and refuses to proceed if anything did post.
 *
 * No other record is touched. The live rules were opened and edited in the UI
 * during capture but every one of those edits was cancelled, not saved.
 *
 * Run from `site/`:
 *   npx --yes tsx scripts/cleanup-recurring-guide-testdata.ts          (dry run)
 *   npx --yes tsx scripts/cleanup-recurring-guide-testdata.ts --apply
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import dns from 'node:dns';
import mongoose from 'mongoose';
import { connectToDatabase } from '../lib/db/mongoose';
import { RecurringTransaction } from '../lib/db/models/pm/RecurringTransaction';
import { Bill } from '../lib/db/models/pm/Bill';
import { JournalEntry } from '../lib/db/models/pm/JournalEntry';
import { ActivityLogEntry } from '../lib/db/models/pm/ActivityLogEntry';

const TEST_MEMO = 'zzGUIDE TEST - DELETE ME';

function loadEnvLocal() {
  for (const line of readFileSync(resolve('.env.local'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && m[1] && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

async function main() {
  loadEnvLocal();
  const apply = process.argv.includes('--apply');
  if (process.env.MONGODB_DNS_SERVERS) {
    dns.setServers(process.env.MONGODB_DNS_SERVERS.split(',').map((s) => s.trim()));
  }
  await connectToDatabase();
  console.log(`connected — mode: ${apply ? 'APPLY' : 'DRY-RUN'}\n`);

  const rules = await RecurringTransaction.find({ memo: TEST_MEMO })
    .select({ _id: 1, memo: 1, nextDate: 1, postedCount: 1 })
    .lean<{ _id: mongoose.Types.ObjectId; memo: string; nextDate: Date; postedCount: number }[]>();

  if (rules.length === 0) {
    console.log('No test rule found — already cleaned up.');
    await mongoose.disconnect();
    return;
  }

  const ids = rules.map((r) => r._id);
  for (const r of rules) {
    console.log(`  rule ${r._id}  "${r.memo}"  next ${r.nextDate?.toISOString().slice(0, 10)}  posted ${r.postedCount}`);
  }

  // Safety gate: the rule must have no ledger footprint. If anything posted,
  // deleting the rule would orphan real accounting records — stop instead.
  const bills = await Bill.countDocuments({ recurringTransactionId: { $in: ids } });
  const jes = await JournalEntry.countDocuments({ recurringTransactionId: { $in: ids } });
  const posted = rules.reduce((s, r) => s + (r.postedCount ?? 0), 0);
  console.log(`\n  bills: ${bills}   journal entries: ${jes}   postedCount: ${posted}`);
  if (bills > 0 || jes > 0 || posted > 0) {
    console.error(
      '\nABORT: the test rule has a ledger footprint. It was supposed to be preview-only.\n' +
        'Investigate and remove the artifacts deliberately before deleting the rule.',
    );
    await mongoose.disconnect();
    process.exitCode = 1;
    return;
  }
  console.log('  clean — preview-only, nothing posted.\n');

  if (!apply) {
    console.log('Dry run. Re-run with --apply to delete.');
    await mongoose.disconnect();
    return;
  }

  const logRes = await ActivityLogEntry.deleteMany({ parentId: { $in: ids } });
  console.log(`ActivityLogEntry rows deleted: ${logRes.deletedCount}`);
  const ruleRes = await RecurringTransaction.deleteMany({ _id: { $in: ids } });
  console.log(`RecurringTransaction rows deleted: ${ruleRes.deletedCount}`);

  await mongoose.disconnect();
  console.log('done — guide test data removed.');
}

main().catch(async (e) => {
  console.error('cleanup failed:', e);
  await mongoose.disconnect().catch(() => {});
  process.exitCode = 1;
});
