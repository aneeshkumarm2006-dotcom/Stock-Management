/**
 * Read-only audit of the PM collections' indexes.
 *
 * Background
 * ----------
 * `lib/db/mongoose.ts` sets no `autoIndex` option, so Mongoose's default of
 * `true` applies: every cold start calls `createIndexes` for each model it
 * touches, unsupervised. Meanwhile `scripts/verify-db.ts` only syncs the STOCK
 * models — no PM model has ever been through `syncIndexes()`.
 *
 * Two consequences make this script necessary:
 *
 *   1. A `createIndex` that fails (e.g. a unique build rejected by pre-existing
 *      duplicates) does not throw at request time. Mongoose emits it on the
 *      model's `index` event, and nothing listens. So an index you believe is
 *      protecting the ledger may simply not exist.
 *   2. Changing a key set does not replace an index — Mongoose derives a new
 *      NAME and creates a second one, leaving the old one enforcing.
 *
 * The recurring poster's idempotency rests entirely on two partial unique
 * indexes (Bill and JournalEntry). If either is missing in production, the
 * "we can't double-post" story is fiction. Run this FIRST, and after every
 * deploy.
 *
 * Safety
 * ------
 * - Strictly read-only. There is no --apply, and it never calls syncIndexes()
 *   (which would DROP every index not in the current schema — an availability
 *   event on a collection this size, and not reversible without a rebuild).
 *
 * Usage (run from `site/`):
 *   npx --yes tsx scripts/verify-pm-indexes.ts
 *   npx --yes tsx scripts/verify-pm-indexes.ts --collection=pm_bills
 */
import dns from 'node:dns';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import mongoose from 'mongoose';
import { connectToDatabase } from '../lib/db/mongoose';
import { Bill } from '../lib/db/models/pm/Bill';
import { JournalEntry } from '../lib/db/models/pm/JournalEntry';
import { Budget } from '../lib/db/models/pm/Budget';
import { CompanyAccount } from '../lib/db/models/pm/CompanyAccount';
import { RecurringTransaction } from '../lib/db/models/pm/RecurringTransaction';
import { Property } from '../lib/db/models/pm/Property';

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

function argValue(flag: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`${flag}=`));
  return hit ? hit.slice(flag.length + 1) : undefined;
}

/** Stable, comparable signature for an index key spec. */
function keySignature(key: Record<string, unknown>): string {
  return Object.entries(key)
    .map(([k, v]) => `${k}:${String(v)}`)
    .join(',');
}

const MODELS = [
  { name: 'pm_bills', model: Bill },
  { name: 'pm_journal_entries', model: JournalEntry },
  { name: 'pm_budgets', model: Budget },
  { name: 'pm_company_accounts', model: CompanyAccount },
  { name: 'pm_recurring_transactions', model: RecurringTransaction },
  { name: 'pm_properties', model: Property },
] as const;

/** Indexes the ledger's correctness actually depends on. */
const CRITICAL: Record<string, string[]> = {
  pm_bills: [
    'organizationId:1,recurringTransactionId:1,recurringPeriodDate:1,scope.id:1',
  ],
  pm_journal_entries: [
    'organizationId:1,recurringTransactionId:1,recurringPeriodDate:1',
  ],
  pm_company_accounts: ['organizationId:1,name:1'],
};

async function main() {
  loadEnvLocal();
  const only = argValue('--collection');

  if (process.env.MONGODB_DNS_SERVERS) {
    dns.setServers(
      process.env.MONGODB_DNS_SERVERS.split(',').map((s) => s.trim()),
    );
  }

  await connectToDatabase();
  console.log('✓ connected (read-only — this script never writes)');

  const conn = mongoose.connection;
  if (!conn?.db) throw new Error('No database handle on the connection.');

  let problems = 0;

  for (const { name, model } of MODELS) {
    if (only && only !== name) continue;
    console.log(`\n=== ${name} ===`);

    const live = await conn.db.collection(name).indexes();
    const liveByKey = new Map(
      live.map((i) => [keySignature(i.key as Record<string, unknown>), i]),
    );

    const schemaIndexes = model.schema.indexes();
    const schemaKeys = new Set(
      schemaIndexes.map(([key]) => keySignature(key as Record<string, unknown>)),
    );

    for (const [key, opts] of schemaIndexes) {
      const sig = keySignature(key as Record<string, unknown>);
      const hit = liveByKey.get(sig);
      const flags = [
        (opts as { unique?: boolean })?.unique ? 'unique' : null,
        (opts as { partialFilterExpression?: unknown })?.partialFilterExpression
          ? 'partial'
          : null,
      ]
        .filter(Boolean)
        .join(' ');
      if (hit) {
        console.log(`  ✓ ${sig}${flags ? `  [${flags}]` : ''}`);
      } else {
        // The dangerous case: the schema declares it, autoIndex was supposed to
        // create it, and it silently isn't there.
        console.log(
          `  ✗ MISSING IN MONGO  ${sig}${flags ? `  [${flags}]` : ''}`,
        );
        problems += 1;
      }
    }

    for (const idx of live) {
      const sig = keySignature(idx.key as Record<string, unknown>);
      if (sig === '_id:1') continue;
      if (!schemaKeys.has(sig)) {
        // Not an error by itself — but syncIndexes() would DROP these, which is
        // exactly why we never run it against a PM collection.
        console.log(`  ~ in Mongo, not in schema: ${sig} (name: ${idx.name})`);
      }
    }

    for (const sig of CRITICAL[name] ?? []) {
      const hit = liveByKey.get(sig);
      if (!hit) {
        console.log(`  ‼ CRITICAL INDEX ABSENT: ${sig}`);
        problems += 1;
      } else if (!hit.unique) {
        console.log(`  ‼ CRITICAL INDEX IS NOT UNIQUE: ${sig}`);
        problems += 1;
      }
    }
  }

  console.log(
    problems === 0
      ? '\n✓ Every schema index is present in Mongo.'
      : `\n‼ ${problems} problem(s). A missing unique index on pm_bills or pm_journal_entries means the recurring poster has NO protection against double-posting — resolve that before shipping anything else.`,
  );

  await mongoose.disconnect();
  if (problems > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error('verify-pm-indexes failed:', err);
  process.exitCode = 1;
});
