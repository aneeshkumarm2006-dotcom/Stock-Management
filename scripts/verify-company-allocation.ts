/**
 * Verifier for named companies + company-cost allocation.
 *
 * Background
 * ----------
 * This project has no test runner (no vitest/jest, no `test` script). For code
 * that splits money, that gap matters more than usual: an off-by-one-cent bug
 * in a monthly recurring rule is invisible on any single screen and compounds
 * quietly forever. So this script is the substitute, and it is meant to be run
 * as a merge gate — not a nicety.
 *
 * Part 1 is pure arithmetic on `allocateCents`, needing no database.
 * Part 2 runs against real data: every company's eligible buildings, and every
 * rule carrying an allocation, asserting the expansion still sums to its source
 * and cannot collide on a bill's idempotency key.
 *
 * Safety
 * ------
 * - Strictly read-only. There is no --apply.
 *
 * Usage (run from `site/`):
 *   npx --yes tsx scripts/verify-company-allocation.ts            # pure checks only
 *   npx --yes tsx scripts/verify-company-allocation.ts --live     # + live data checks
 */
import dns from 'node:dns';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import mongoose, { Types } from 'mongoose';
import { connectToDatabase } from '../lib/db/mongoose';
import { allocateCents } from '../lib/pm/allocation';
import { RecurringTransaction } from '../lib/db/models/pm/RecurringTransaction';
import { CompanyAccount } from '../lib/db/models/pm/CompanyAccount';
import {
  createCompanyPropertyResolver,
  resolveCompanyProperties,
} from '../lib/pm/companyProperties';
import { expandRuleAmounts, groupPostingLines } from '../lib/pm/recurringPoster';

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

let failures = 0;
function check(label: string, ok: boolean, detail?: string) {
  if (ok) {
    console.log(`  ✓ ${label}`);
  } else {
    failures += 1;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function pureChecks() {
  console.log('\n=== allocateCents (pure) ===');

  const weightSets = [
    [1],
    [1, 1],
    [1, 1, 1],
    [1, 1, 1, 1, 1, 1, 1],
    [3, 1],
    [5, 3, 2],
    [1, 1000000],
  ];
  const totals = [
    0, 1, 2, 7, 99, 100, 101, 333, 1000, 4800_00, 123456789, -1, -7, -333,
    -4800_00,
  ];

  let sumOk = true;
  let signOk = true;
  for (const ws of weightSets) {
    const weights = ws.map((w, i) => ({ key: `p${i}`, weight: w }));
    for (const total of totals) {
      const shares = allocateCents(total, weights);
      const sum = shares.reduce((s, x) => s + x.cents, 0);
      if (sum !== total) {
        sumOk = false;
        console.log(`      total=${total} weights=${ws} summed to ${sum}`);
      }
      // Negatives must mirror positives exactly, or a credit note would split
      // differently from the debit it reverses.
      if (total > 0) {
        const neg = allocateCents(-total, weights);
        const mirrored = neg.every(
          (n, i) => n.cents === -(shares[i]?.cents ?? 0),
        );
        if (!mirrored) {
          signOk = false;
          console.log(`      total=${total} weights=${ws} is not sign-symmetric`);
        }
      }
    }
  }
  check('shares always sum exactly to the source', sumOk);
  check('negative totals mirror positive totals', signOk);

  check(
    'single weight takes the whole amount',
    allocateCents(12345, [{ key: 'a', weight: 1 }])[0]?.cents === 12345,
  );
  check(
    'zero total yields zero shares for every member',
    allocateCents(0, [
      { key: 'a', weight: 1 },
      { key: 'b', weight: 1 },
    ]).every((s) => s.cents === 0),
  );
  check(
    'all-zero weights yields an empty result (caller decides the fallback)',
    allocateCents(1000, [
      { key: 'a', weight: 0 },
      { key: 'b', weight: 0 },
    ]).length === 0,
  );
  check(
    'more members than cents leaves some shares at zero, still summing',
    (() => {
      const shares = allocateCents(2, [
        { key: 'a', weight: 1 },
        { key: 'b', weight: 1 },
        { key: 'c', weight: 1 },
      ]);
      return (
        shares.reduce((s, x) => s + x.cents, 0) === 2 &&
        shares.some((s) => s.cents === 0)
      );
    })(),
  );
  check(
    'deterministic across calls',
    JSON.stringify(
      allocateCents(1000, [
        { key: 'a', weight: 1 },
        { key: 'b', weight: 1 },
        { key: 'c', weight: 1 },
      ]),
    ) ===
      JSON.stringify(
        allocateCents(1000, [
          { key: 'a', weight: 1 },
          { key: 'b', weight: 1 },
          { key: 'c', weight: 1 },
        ]),
      ),
  );
  check(
    'the odd penny goes to the first member (caller controls it by ordering)',
    allocateCents(1000, [
      { key: 'a', weight: 1 },
      { key: 'b', weight: 1 },
      { key: 'c', weight: 1 },
    ])[0]?.cents === 334,
  );
  check(
    'input order is preserved in the output',
    allocateCents(300, [
      { key: 'z', weight: 1 },
      { key: 'a', weight: 1 },
    ])
      .map((s) => s.key)
      .join(',') === 'z,a',
  );
  check(
    'non-finite totals throw rather than reaching the ledger',
    (() => {
      try {
        allocateCents(Number.NaN, [{ key: 'a', weight: 1 }]);
        return false;
      } catch {
        return true;
      }
    })(),
  );
}

async function liveChecks() {
  const companies = await CompanyAccount.find({ active: true }).lean<
    Array<{ _id: Types.ObjectId; organizationId: Types.ObjectId; name?: string }>
  >();

  console.log('\n=== Companies (live) ===');
  for (const c of companies) {
    const set = await resolveCompanyProperties({
      orgId: c.organizationId,
      companyAccountId: c._id,
    });
    if (!set) {
      console.log(`  ${c.name}: could not resolve`);
      continue;
    }
    console.log(
      `  ${set.companyName} [${set.currency}] — ${set.members.length} eligible building(s)${
        set.allocatable ? '' : '  (NOT allocatable)'
      }`,
    );
    for (const m of set.members) {
      console.log(`      • ${m.propertyName} (${m.currency})`);
    }
    for (const e of set.excluded) {
      console.log(`      ! excluded ${e.propertyName} (${e.currency}) — ${e.reason}`);
    }
  }

  console.log('\n=== Rules with an allocated line (live) ===');
  const rules = await RecurringTransaction.find({ active: true });
  let checked = 0;

  for (const rule of rules) {
    const hasAllocation = (rule.amounts ?? []).some(
      (a) => a.allocation?.mode === 'CompanyProperties',
    );
    if (!hasAllocation) continue;
    checked += 1;

    const resolveCompany = createCompanyPropertyResolver(
      String(rule.organizationId),
    );
    const expanded = await expandRuleAmounts({ rule, resolve: resolveCompany });

    const sourceTotal = (rule.amounts ?? []).reduce(
      (s, a) => s + (a.amount ?? 0),
      0,
    );
    const expandedTotal = expanded.lines.reduce((s, l) => s + l.amount, 0);

    console.log(`\n  Rule ${String(rule._id)} — ${rule.memo ?? '(no memo)'}`);
    for (const l of expanded.lines) {
      console.log(
        `      ${l.allocatedFromCompanyId ? '↳ ' : '  '}${(l.amount / 100).toFixed(2)}  ${l.description ?? ''}`,
      );
    }
    for (const n of expanded.notes) console.log(`      ! ${n}`);

    // Expansion must never create or destroy money. A zero share is dropped
    // (Bill.pre('validate') rejects an all-zero bill), so a tiny amount split
    // across more buildings than it has cents will legitimately be short —
    // report that rather than failing.
    check(
      `expansion preserves the total (${sourceTotal} cents)`,
      expandedTotal === sourceTotal,
      `expanded to ${expandedTotal}`,
    );

    // Two groups sharing a scope.id would violate the Bill unique index and be
    // swallowed as a duplicate, losing one group's money.
    const groups = groupPostingLines(expanded.lines);
    const keys = groups.map((g) => g.key);
    check(
      'no two posting groups share a scope',
      new Set(keys).size === keys.length,
      keys.join(', '),
    );
  }

  if (checked === 0) {
    console.log('  (no active rules carry an allocation yet)');
  }
}

async function main() {
  loadEnvLocal();
  const live = process.argv.includes('--live');

  pureChecks();

  if (live) {
    if (process.env.MONGODB_DNS_SERVERS) {
      dns.setServers(
        process.env.MONGODB_DNS_SERVERS.split(',').map((s) => s.trim()),
      );
    }
    await connectToDatabase();
    console.log('✓ connected (read-only)');
    await liveChecks();
    await mongoose.disconnect();
  } else {
    console.log('\n(pass --live to also check real companies and rules)');
  }

  console.log(
    failures === 0
      ? '\n✓ All checks passed.'
      : `\n✗ ${failures} check(s) failed.`,
  );
  if (failures > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error('verify-company-allocation failed:', err);
  process.exitCode = 1;
});
