/**
 * READ-ONLY audit: how much did the void/reversal double-count distort reports?
 *
 * Background
 * ----------
 * Voiding a Posted JE flips the original to `Voided` AND writes a Posted
 * mirror-image reversal. Every report matched on `status: 'Posted'` alone, so
 * it dropped the original and kept the reversal — leaving a bare −amount that
 * subtracted from unrelated transactions in the same account/property/period.
 *
 *   Bob's case: Jan 2026 School Taxes on IMMEUBLES GREENE Metro 1280 Ave Greene
 *   → bill A C$711.43 voided, bill B C$724.73 live
 *   → Financials rendered 724.73 − 711.43 = C$13.30
 *
 * The fix is `ledgerVisibleMatch()` (lib/pm/ledgerVisibility.ts), which
 * excludes BOTH halves of a voided pair. This script quantifies the change
 * without touching a single document: for each affected account/property/month
 * it prints what the P&L showed before and what it shows now.
 *
 * It writes NOTHING. There is no --apply flag, by design: the fix is at the
 * read layer, so no historical data needs repairing.
 *
 * Run from `site/`:
 *   npx --yes tsx scripts/audit-void-reversal-impact.ts
 *   npx --yes tsx scripts/audit-void-reversal-impact.ts --account="School Taxes"
 */
import dns from 'node:dns';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import mongoose, { Types } from 'mongoose';
import { connectToDatabase } from '../lib/db/mongoose';
import { JournalEntry } from '../lib/db/models/pm/JournalEntry';
import { ChartOfAccount } from '../lib/db/models/pm/ChartOfAccount';
import { Property } from '../lib/db/models/pm/Property';

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

function argValue(flag: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`${flag}=`));
  return hit ? hit.slice(flag.length + 1) : undefined;
}

const money = (cents: number) =>
  `${cents < 0 ? '-' : ''}$${Math.abs(cents / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

interface JeLite {
  _id: Types.ObjectId;
  date: Date;
  memo?: string;
  status: string;
  reversesJournalEntryId?: Types.ObjectId | null;
  lines: Array<{
    accountId: Types.ObjectId;
    scopeType: string;
    scopeId: Types.ObjectId | null;
    debit: number;
    credit: number;
  }>;
}

async function main() {
  loadEnvLocal();
  if (process.env.MONGODB_DNS_SERVERS) {
    dns.setServers(process.env.MONGODB_DNS_SERVERS.split(',').map((s) => s.trim()));
  }
  await connectToDatabase();
  console.log('connected (READ-ONLY — this script never writes)\n');

  const accountFilter = argValue('--account');

  // Every reversal still counted by the OLD rule: Posted, and pointing at an
  // original. These are exactly the rows the fix now excludes.
  const reversals = await JournalEntry.find({
    status: 'Posted',
    reversesJournalEntryId: { $ne: null },
  }).lean<JeLite[]>();

  if (reversals.length === 0) {
    console.log('No Posted reversals found — nothing was being double-counted.');
    await mongoose.disconnect();
    return;
  }

  const [accounts, properties] = await Promise.all([
    ChartOfAccount.find({}, { _id: 1, name: 1, type: 1 }).lean<
      Array<{ _id: Types.ObjectId; name: string; type: string }>
    >(),
    Property.find({}, { _id: 1, propertyName: 1 }).lean<
      Array<{ _id: Types.ObjectId; propertyName: string }>
    >(),
  ]);
  const acctById = new Map(accounts.map((a) => [String(a._id), a]));
  const propById = new Map(properties.map((p) => [String(p._id), p.propertyName]));

  // Bucket the phantom amounts by the cell a P&L would show them in.
  //
  // Keyed on the account/scope OBJECT IDS, not their display names: every org
  // seeds its own chart of accounts, so several distinct "School Taxes" rows
  // exist across the database and matching by name resolves to whichever one
  // sorts first — usually another org's, whose id then matches no line at all.
  const buckets = new Map<
    string,
    {
      accountId: string;
      account: string;
      type: string;
      scopeId: string | null;
      scope: string;
      month: string;
      phantom: number;
    }
  >();

  for (const rev of reversals) {
    const month = `${rev.date.getUTCFullYear()}-${String(rev.date.getUTCMonth() + 1).padStart(2, '0')}`;
    for (const line of rev.lines) {
      const acct = acctById.get(String(line.accountId));
      if (!acct) continue;
      if (acct.type !== 'Income' && acct.type !== 'Operating Expense') continue;
      if (accountFilter && !acct.name.toLowerCase().includes(accountFilter.toLowerCase())) {
        continue;
      }
      const scopeId =
        line.scopeType === 'Property' && line.scopeId ? String(line.scopeId) : null;
      const scope = scopeId
        ? propById.get(scopeId) ?? 'Unknown property'
        : 'Company';
      // Same sign convention as /api/pm/financials/matrix.
      const net = line.credit - line.debit;
      const signed = acct.type === 'Operating Expense' ? -net : net;
      const key = `${String(acct._id)}|${scopeId ?? 'company'}|${month}`;
      const b = buckets.get(key) ?? {
        accountId: String(acct._id),
        account: acct.name,
        type: acct.type,
        scopeId,
        scope,
        month,
        phantom: 0,
      };
      b.phantom += signed;
      buckets.set(key, b);
    }
  }

  const affected = Array.from(buckets.values()).filter((b) => b.phantom !== 0);
  affected.sort(
    (a, b) => a.month.localeCompare(b.month) || a.account.localeCompare(b.account),
  );

  console.log(
    `${reversals.length} Posted reversal entr${reversals.length === 1 ? 'y' : 'ies'} in the ledger.`,
  );
  console.log(`${affected.length} P&L cell(s) were distorted by them.\n`);

  // For each distorted cell, recompute the "before" and "after" figures the
  // Financials matrix would render, so the difference is checkable by eye.
  for (const b of affected) {
    const acct = acctById.get(b.accountId);
    if (!acct) continue;
    const parts = b.month.split('-').map(Number);
    const y = parts[0] ?? 1970;
    const m = parts[1] ?? 1;
    const start = new Date(Date.UTC(y, m - 1, 1));
    const end = new Date(Date.UTC(y, m, 0, 23, 59, 59, 999));

    const inMonth = await JournalEntry.find({
      status: 'Posted',
      date: { $gte: start, $lte: end },
      'lines.accountId': acct._id,
    }).lean<JeLite[]>();

    const sumFor = (rows: JeLite[]) => {
      let total = 0;
      for (const je of rows) {
        for (const line of je.lines) {
          if (String(line.accountId) !== String(acct._id)) continue;
          const lineScopeId =
            line.scopeType === 'Property' && line.scopeId ? String(line.scopeId) : null;
          if (lineScopeId !== b.scopeId) continue;
          const net = line.credit - line.debit;
          total += acct.type === 'Operating Expense' ? -net : net;
        }
      }
      return total;
    };

    const before = sumFor(inMonth); // old rule: every Posted row
    const after = sumFor(inMonth.filter((je) => !je.reversesJournalEntryId)); // new rule

    console.log(`${b.account} · ${b.scope} · ${b.month}`);
    console.log(`   was showing : ${money(before)}   <- wrong`);
    console.log(`   now shows   : ${money(after)}   <- correct`);
    console.log(`   recovered   : ${money(after - before)}`);
    const culprits = inMonth.filter((je) => je.reversesJournalEntryId);
    for (const c of culprits) {
      console.log(`   phantom row : ${c.date.toISOString().slice(0, 10)}  ${c.memo ?? ''}`);
    }
    console.log('');
  }

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});
