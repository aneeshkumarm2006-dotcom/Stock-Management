/**
 * Before/after reconciler for the named-companies + allocation change.
 *
 * Background
 * ----------
 * Deploy 1 (named companies selectable, buildings assigned to companies) must
 * not move a single number: it changes what a scope is CALLED and what it can
 * be linked to, never what anything totals. Deploy 2 (allocation) moves numbers
 * on purpose, but only by RECLASSIFYING — money leaves the company column and
 * reappears, to the cent, across property columns.
 *
 * So both deploys reduce to one invariant: **the grand total does not change.**
 * That is what this prints, in a stable diffable format. Capture it before,
 * capture it after, diff the two.
 *
 * Reads the ledger directly rather than through the API so it needs no session.
 *
 * Safety
 * ------
 * - Strictly read-only. There is no --apply.
 *
 * Usage (run from `site/`):
 *   npx --yes tsx scripts/verify-company-scope-migration.ts > before.txt
 *   # ... deploy ...
 *   npx --yes tsx scripts/verify-company-scope-migration.ts > after.txt
 *   diff before.txt after.txt
 *
 *   npx --yes tsx scripts/verify-company-scope-migration.ts --from=2026-01-01 --to=2026-12-31
 */
import dns from 'node:dns';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import mongoose, { Types } from 'mongoose';
import { connectToDatabase } from '../lib/db/mongoose';
import { JournalEntry } from '../lib/db/models/pm/JournalEntry';
import { ChartOfAccount } from '../lib/db/models/pm/ChartOfAccount';
import { Property } from '../lib/db/models/pm/Property';
import { Bill } from '../lib/db/models/pm/Bill';
import { Organization } from '../lib/db/models/pm/Organization';
import { normalizeScope, scopeKey } from '../lib/pm/scope';

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

const money = (cents: number) => (cents / 100).toFixed(2).padStart(16);

async function main() {
  loadEnvLocal();
  const from = new Date(argValue('--from') ?? '2000-01-01');
  const to = new Date(argValue('--to') ?? '2100-01-01');

  if (process.env.MONGODB_DNS_SERVERS) {
    dns.setServers(
      process.env.MONGODB_DNS_SERVERS.split(',').map((s) => s.trim()),
    );
  }

  await connectToDatabase();
  console.error('✓ connected (read-only)');

  const orgs = await Organization.find({})
    .select({ _id: 1, name: 1 })
    .lean<Array<{ _id: Types.ObjectId; name?: string }>>();

  for (const org of orgs) {
    console.log(`\n########## ORG ${org.name ?? String(org._id)} ##########`);
    console.log(
      `window: ${from.toISOString().slice(0, 10)} .. ${to.toISOString().slice(0, 10)}`,
    );

    const [accounts, properties, jes] = await Promise.all([
      ChartOfAccount.find(
        { organizationId: org._id, type: { $in: ['Income', 'Operating Expense'] } },
        { _id: 1, type: 1 },
      ).lean<Array<{ _id: Types.ObjectId; type: string }>>(),
      Property.find({ organizationId: org._id })
        .select({ _id: 1, propertyName: 1 })
        .lean<Array<{ _id: Types.ObjectId; propertyName?: string }>>(),
      JournalEntry.find({
        organizationId: org._id,
        status: 'Posted',
        date: { $gte: from, $lte: to },
      })
        .select('lines')
        .lean<
          Array<{
            lines: Array<{
              accountId: Types.ObjectId;
              scopeType?: string | null;
              scopeId?: Types.ObjectId | null;
              debit?: number;
              credit?: number;
            }>;
          }>
        >(),
    ]);

    const typeById = new Map(accounts.map((a) => [String(a._id), a.type]));
    const nameById = new Map(
      properties.map((p) => [String(p._id), p.propertyName ?? '(unnamed)']),
    );

    // (1) Per-scope net, and the grand total. This is the headline invariant:
    // reclassification moves money BETWEEN rows, never changes the last line.
    const byScope = new Map<string, { income: number; expense: number }>();
    let debits = 0;
    let credits = 0;

    for (const je of jes) {
      for (const line of je.lines ?? []) {
        debits += line.debit ?? 0;
        credits += line.credit ?? 0;

        const type = typeById.get(String(line.accountId));
        if (!type) continue;
        const scope = normalizeScope(line);
        const key =
          scope.type === 'Property'
            ? `PROP ${nameById.get(String(scope.id)) ?? String(scope.id)}`
            : scope.id
              ? `CO   ${String(scope.id)}`
              : 'CO   (unnamed / legacy)';
        const bucket = byScope.get(key) ?? { income: 0, expense: 0 };
        if (type === 'Income') {
          bucket.income += (line.credit ?? 0) - (line.debit ?? 0);
        } else {
          bucket.expense += (line.debit ?? 0) - (line.credit ?? 0);
        }
        byScope.set(key, bucket);
      }
    }

    console.log('\n--- (1) Net by scope ---');
    let grandIncome = 0;
    let grandExpense = 0;
    for (const key of Array.from(byScope.keys()).sort()) {
      const b = byScope.get(key)!;
      grandIncome += b.income;
      grandExpense += b.expense;
      console.log(
        `${money(b.income)} ${money(b.expense)} ${money(b.income - b.expense)}  ${key}`,
      );
    }
    console.log(
      `${money(grandIncome)} ${money(grandExpense)} ${money(grandIncome - grandExpense)}  == GRAND TOTAL ==`,
    );

    // (2) The only check that catches an orphaned journal entry left behind by
    // a partially-rolled-back posting period.
    console.log('\n--- (2) Ledger balance ---');
    console.log(`debits  ${money(debits)}`);
    console.log(`credits ${money(credits)}`);
    console.log(
      debits === credits
        ? 'balanced ✓'
        : `‼ OUT OF BALANCE by ${money(debits - credits)}`,
    );

    // (3) Recurring bill counts per period — a re-run that creates extra bills
    // shows up here immediately.
    console.log('\n--- (3) Recurring bills per period ---');
    const recurringBills = await Bill.aggregate([
      {
        $match: {
          organizationId: org._id,
          recurringTransactionId: { $ne: null },
        },
      },
      {
        $group: {
          _id: '$recurringPeriodDate',
          count: { $sum: 1 },
          cents: { $sum: '$amount' },
        },
      },
      { $sort: { _id: -1 } },
      { $limit: 12 },
    ]);
    for (const row of recurringBills) {
      const d = row._id instanceof Date ? row._id.toISOString().slice(0, 10) : '?';
      console.log(`${d}  bills=${row.count}  ${money(row.cents ?? 0)}`);
    }

    // (4) How many GL lines still carry the legacy unnamed company bucket.
    // Expected to stay CONSTANT: historical rows are never rewritten.
    const legacyCompanyLines = jes.reduce(
      (s, je) =>
        s +
        (je.lines ?? []).filter(
          (l) => scopeKey(normalizeScope(l)) === 'C:-',
        ).length,
      0,
    );
    console.log(`\n--- (4) Legacy unnamed-company GL lines: ${legacyCompanyLines}`);
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('verify-company-scope-migration failed:', err);
  process.exitCode = 1;
});
