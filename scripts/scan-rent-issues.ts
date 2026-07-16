/**
 * READ-ONLY scan for the client's rent-posting issues. Reports:
 *  (A) Duplicate first-month rent: leases with BOTH a "Move-in JE" and a
 *      "Rent charge" posting the same month's rent (Issue 2).
 *  (B) Historical rent coverage: active leases and which months between a
 *      horizon and last month have NO base-rent JE (Issue 3), plus the backfill
 *      volume for a few candidate horizons.
 *
 * Run from site/:  npx --yes tsx scripts/scan-rent-issues.ts
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
const money = (c: number) => `$${(c / 100).toFixed(2)}`;
const ymd = (x: unknown) => (x ? new Date(x as string).toISOString().slice(0, 10) : '—');
const ym = (x: unknown) => ymd(x).slice(0, 7);

interface JeLine {
  accountId?: unknown;
  scopeId?: unknown;
  scopeType?: string;
  debit?: number;
  credit?: number;
}
interface Je {
  _id: unknown;
  date?: unknown;
  status?: string;
  memo?: string;
  lines?: JeLine[];
}

async function main() {
  loadEnvLocal();
  if (process.env.MONGODB_DNS_SERVERS)
    dns.setServers(process.env.MONGODB_DNS_SERVERS.split(',').map((s) => s.trim()));
  await connectToDatabase();
  const db = mongoose.connection.db;
  if (!db) throw new Error('no db handle');
  const orgId = new mongoose.Types.ObjectId(ORG_ID);

  const incomeCoas = await db
    .collection('pm_chart_of_accounts')
    .find({ organizationId: orgId, type: 'Income' })
    .toArray();
  const incomeIds = new Set(incomeCoas.map((c) => String(c._id)));

  const posted = (await db
    .collection('pm_journal_entries')
    .find({ organizationId: orgId, status: 'Posted' })
    .toArray()) as unknown as Je[];

  // ---------- (A) duplicate first-month rent ----------
  console.log('=== (A) Duplicate first-month rent (Move-in JE + Rent charge, same lease+month) ===');
  const moveIns = posted.filter((j) => /^Move-in JE for lease #(\d+)/.test(j.memo ?? ''));
  let dupCount = 0;
  for (const mi of moveIns) {
    const num = (mi.memo ?? '').match(/lease #(\d+)/)?.[1];
    if (!num) continue;
    const miMonth = ym(mi.date);
    const miIncome = (mi.lines ?? [])
      .filter((l) => incomeIds.has(String(l.accountId)))
      .reduce((s, l) => s + ((l.credit ?? 0) - (l.debit ?? 0)), 0);
    // A recurring "Rent charge for lease #N" in the same month.
    const rc = posted.find(
      (j) =>
        j !== mi &&
        new RegExp(`^Rent charge for lease #${num}\\b`).test(j.memo ?? '') &&
        ym(j.date) === miMonth,
    );
    if (rc && miIncome > 0) {
      const rcIncome = (rc.lines ?? [])
        .filter((l) => incomeIds.has(String(l.accountId)))
        .reduce((s, l) => s + ((l.credit ?? 0) - (l.debit ?? 0)), 0);
      dupCount++;
      console.log(
        `  Lease #${num} month ${miMonth}: move-in income ${money(miIncome)} (JE ${String(mi._id)}) + recurring ${money(rcIncome)} (JE ${String(rc._id)}) => DOUBLE`,
      );
    }
  }
  if (dupCount === 0) console.log('  none found');

  // ---------- (B) historical rent coverage ----------
  const leases = await db
    .collection('pm_leases')
    .find({ organizationId: orgId, status: { $in: ['Active', 'Future'] } })
    .toArray();

  // months (YYYY-MM) that already have a base-rent JE, per property+unit scope, from any lease.
  // We key rent JEs by month only per lease propertyId for a coarse coverage picture.
  const now = new Date();
  const thisMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;

  // Build a set of "propertyId|YYYY-MM" that have ANY income posting.
  const coveredPropMonth = new Set<string>();
  for (const j of posted) {
    for (const l of j.lines ?? []) {
      if (incomeIds.has(String(l.accountId)) && (l.credit ?? 0) > 0 && l.scopeId) {
        coveredPropMonth.add(`${String(l.scopeId)}|${ym(j.date)}`);
      }
    }
  }

  const horizons = ['2024-01', '2025-01', '2026-01'];
  const horizonTotals: Record<string, number> = { '2024-01': 0, '2025-01': 0, '2026-01': 0 };

  console.log('\n=== (B) Active/Future leases: missing base-rent months (per property scope) ===');
  for (const l of leases) {
    const start = l.startDate ? new Date(l.startDate as string) : null;
    const rent = (l.primaryRent && (l.primaryRent as { amount?: number }).amount) ?? 0;
    if (!start || rent <= 0) continue;
    const pid = String(l.propertyId);
    // enumerate months from start to last month (exclusive of current month)
    const missing: string[] = [];
    const cur = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
    const endExcl = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)); // first of this month
    while (cur < endExcl) {
      const mk = `${cur.getUTCFullYear()}-${String(cur.getUTCMonth() + 1).padStart(2, '0')}`;
      if (!coveredPropMonth.has(`${pid}|${mk}`)) missing.push(mk);
      cur.setUTCMonth(cur.getUTCMonth() + 1);
    }
    for (const h of horizons) {
      horizonTotals[h] = (horizonTotals[h] ?? 0) + missing.filter((m) => m >= h).length;
    }
    const recent = missing.filter((m) => m >= '2025-01');
    console.log(
      `  #${l.leaseNumber} ${l.status} start=${ymd(l.startDate)} rent=${money(rent)} | missing months total=${missing.length}, since2025=${recent.length}`,
    );
  }

  console.log('\n=== (B) Backfill volume (approx JE count) by horizon — property-month gaps ===');
  for (const h of horizons) console.log(`  since ${h}: ~${horizonTotals[h]} lease-months missing (excluding ${thisMonth})`);

  await mongoose.disconnect();
  console.log('\n✓ done');
}
main().catch((e) => {
  console.error('✗', e);
  process.exitCode = 1;
});
