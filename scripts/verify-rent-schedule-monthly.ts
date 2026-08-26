/**
 * READ-ONLY verification of the monthly-amount rent schedule, exercising the
 * REAL code paths the UI uses:
 *   DB doc -> GET /api/pm/leases/[id] serialization -> scheduleApiToRows (the
 *   Edit-lease form) -> scheduleRowsToPayload (save) -> mapRentScheduleToModel
 *   (what would be written back).
 *
 * Proves the client's bug is gone: what they type is what is stored, shown, and
 * posted — and a save round-trip no longer inflates anything.
 *
 * Run from site/:  npx --yes tsx scripts/verify-rent-schedule-monthly.ts
 */
import dns from 'node:dns';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import mongoose from 'mongoose';
import { connectToDatabase } from '../lib/db/mongoose';
import {
  computePeriodAmounts,
  activeTermPeriodForDate,
  resolveScheduledRentForDate,
  type SchedulePeriod,
} from '../lib/pm/rentSchedule';
import {
  mapRentScheduleToModel,
  deriveCurrentRentFromSchedule,
} from '../lib/validation/pm/rentSchedule';
import {
  scheduleApiToRows,
  scheduleRowsToPayload,
} from '../components/pm/LeaseTermScheduleEditor';

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

const money = (c: number) => `$${(c / 100).toFixed(2)}`;
const ymd = (x: unknown) => (x ? new Date(x as string).toISOString().slice(0, 10) : '—');

let failures = 0;
function check(name: string, ok: boolean, detail: string) {
  if (!ok) failures++;
  console.log(`   ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

interface Period {
  label: string;
  kind: 'Term' | 'RenewalOption';
  leaseType?: 'Fixed' | 'Fixed w/rollover' | 'At-will';
  startDate: Date;
  /** Null on an open-ended At-will period. */
  endDate: Date | null;
  sizeSqft?: number;
  baseMonthlyAmount?: number;
  opexMonthlyAmount?: number;
  taxMonthlyAmount?: number;
  baseAccountId?: mongoose.Types.ObjectId | null;
  opexAccountId?: mongoose.Types.ObjectId | null;
  taxAccountId?: mongoose.Types.ObjectId | null;
}

async function main() {
  loadEnvLocal();
  if (process.env.MONGODB_DNS_SERVERS)
    dns.setServers(process.env.MONGODB_DNS_SERVERS.split(',').map((s) => s.trim()));
  await connectToDatabase();
  const db = mongoose.connection.db;
  if (!db) throw new Error('no db handle');

  const today = new Date();
  const augustDue = new Date('2026-08-01T00:00:00.000Z');

  const leases = await db
    .collection('pm_leases')
    .find({ rentSchedule: { $exists: true, $ne: [] } })
    .sort({ leaseNumber: 1 })
    .toArray();

  for (const doc of leases) {
    const periods = (doc.rentSchedule ?? []) as Period[];
    console.log(`\n=== Lease #${doc.leaseNumber} — ${periods.length} period(s)`);

    // 1. GET serialization (mirrors app/api/pm/leases/[id]/route.ts exactly).
    const apiPeriods = periods.map((p) => ({
      label: p.label,
      kind: p.kind,
      leaseType: p.leaseType ?? ('Fixed' as const),
      startDate: p.startDate ? new Date(p.startDate).toISOString() : null,
      endDate: p.endDate ? new Date(p.endDate).toISOString() : null,
      sizeSqft: p.sizeSqft ?? 0,
      baseMonthlyAmount: p.baseMonthlyAmount ?? 0,
      baseAccountId: p.baseAccountId ? String(p.baseAccountId) : null,
      opexMonthlyAmount: p.opexMonthlyAmount ?? 0,
      opexAccountId: p.opexAccountId ? String(p.opexAccountId) : null,
      taxMonthlyAmount: p.taxMonthlyAmount ?? 0,
      taxAccountId: p.taxAccountId ? String(p.taxAccountId) : null,
      amounts: computePeriodAmounts(
        {
          sizeSqft: p.sizeSqft ?? 0,
          baseMonthlyAmount: p.baseMonthlyAmount ?? 0,
          opexMonthlyAmount: p.opexMonthlyAmount ?? 0,
          taxMonthlyAmount: p.taxMonthlyAmount ?? 0,
        },
        doc.salesTaxRatePct ?? null,
      ),
    }));

    // 2. What the Edit-lease form inputs will show.
    const rows = scheduleApiToRows(apiPeriods);
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]!;
      const a = apiPeriods[i]!;
      console.log(
        `   "${r.label}" ${r.startDate}→${r.endDate}: inputs Base ${r.baseAmount || '0'} / ` +
          `OPEX ${r.opexAmount || '0'} / Tax ${r.taxAmount || '0'}  ` +
          `→ shows ${money(a.amounts.totalBeforeTaxMonthly)}/mo, ${money(a.amounts.totalBeforeTaxAnnual)}/yr`,
      );
      check(
        `input matches stored (${r.label})`,
        Math.round(Number(r.baseAmount || 0) * 100) === a.baseMonthlyAmount,
        `input ${r.baseAmount || 0} vs stored ${money(a.baseMonthlyAmount)}`,
      );
      check(
        `monthly total = base+opex+tax (${r.label})`,
        a.amounts.totalBeforeTaxMonthly ===
          a.baseMonthlyAmount + a.opexMonthlyAmount + a.taxMonthlyAmount,
        '',
      );
      check(
        `annual = monthly x 12 (${r.label})`,
        a.amounts.totalBeforeTaxAnnual === a.amounts.totalBeforeTaxMonthly * 12,
        '',
      );
    }

    // 3. Save round-trip: form rows -> payload -> model. Must be a no-op.
    const roundTripped = mapRentScheduleToModel(scheduleRowsToPayload(rows));
    const stableAll = roundTripped.every((rt, i) => {
      const orig = periods[i]!;
      return (
        rt.baseMonthlyAmount === (orig.baseMonthlyAmount ?? 0) &&
        rt.opexMonthlyAmount === (orig.opexMonthlyAmount ?? 0) &&
        rt.taxMonthlyAmount === (orig.taxMonthlyAmount ?? 0)
      );
    });
    check(
      'save round-trip does not change any amount',
      stableAll && roundTripped.length === periods.length,
      stableAll ? '' : 'AMOUNTS DRIFTED ON SAVE',
    );

    // The per-period lease type and its open-ended end date have to survive the
    // same trip: a stored At-will period silently reading back as a bounded
    // Fixed one is exactly the drift the amounts check above would not catch.
    const typesStable = roundTripped.every((rt, i) => {
      const orig = periods[i]!;
      const origType = orig.leaseType ?? 'Fixed';
      const origEnd = orig.endDate ? new Date(orig.endDate).getTime() : null;
      const rtEnd = rt.endDate ? new Date(rt.endDate).getTime() : null;
      return rt.leaseType === origType && rtEnd === origEnd;
    });
    check(
      'save round-trip preserves lease type and open-ended end date',
      typesStable,
      typesStable ? '' : 'LEASE TYPE OR END DATE DRIFTED ON SAVE',
    );

    // 4. What the Revenue rows / rent roll show now.
    const derived = deriveCurrentRentFromSchedule(
      periods as unknown as Parameters<typeof deriveCurrentRentFromSchedule>[0],
      today,
    );
    const storedTotal =
      Number(doc.primaryRent?.amount ?? 0) +
      ((doc.splitRentCharges ?? []) as { amount?: number }[]).reduce(
        (s, c) => s + Number(c.amount ?? 0),
        0,
      );
    console.log(
      `   Revenue rows: primaryRent ${money(Number(doc.primaryRent?.amount ?? 0))} + splits ` +
        `= ${money(storedTotal)}/mo (nextDueDate ${ymd(doc.primaryRent?.nextDueDate)})`,
    );
    check('stored rent is a plausible monthly rent (< $100k)', storedTotal < 10_000_000, money(storedTotal));

    const active = activeTermPeriodForDate(periods as unknown as SchedulePeriod[], today);
    if (active && derived) {
      const derivedTotal =
        derived.amount + derived.splitRentCharges.reduce((s, c) => s + c.amount, 0);
      check(
        'Revenue rows match the active term period',
        derivedTotal === storedTotal,
        `active "${active.label}" ${money(derivedTotal)} vs stored ${money(storedTotal)}`,
      );
    }

    // 5. What will actually post on the next due date (2026-08-01).
    const src = resolveScheduledRentForDate(
      {
        rentSchedule: periods as unknown as SchedulePeriod[],
        primaryRent: doc.primaryRent,
        splitRentCharges: doc.splitRentCharges ?? [],
        propertyId: doc.propertyId,
        unitId: doc.unitId,
      },
      augustDue,
    );
    if (!src) {
      console.log(`   Aug 1 posting: NOTHING (no term period covers 2026-08-01)`);
    } else {
      const postTotal =
        src.primaryRent.amount + src.splitRentCharges.reduce((s, c) => s + c.amount, 0);
      console.log(`   Aug 1 posting: ${money(postTotal)}`);
      check('Aug 1 posting is a plausible monthly rent (< $100k)', postTotal < 10_000_000, money(postTotal));
    }
  }

  console.log(
    `\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`,
  );
  await mongoose.disconnect();
  if (failures > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
