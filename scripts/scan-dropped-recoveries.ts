/**
 * Read-only audit: finds leases whose NEXT rent charge will silently drop an
 * income line that their LAST posted rent charge included.
 *
 * The failure mode this catches (the one that hit leases #4/#14/#18 in August
 * 2026): once a `rentSchedule` exists it supersedes `splitRentCharges` entirely
 * — only the Term period covering the due date posts, and only for components
 * that have BOTH an amount and an income account. A term row saved with the
 * OPEX/Tax column blank therefore stops a recovery that was posting the month
 * before, with nothing in the UI saying so.
 *
 * Method: resolve what will post on `primaryRent.nextDueDate` via the real
 * poster path (`resolveScheduledRentForDate`), then diff its income accounts
 * against the credit lines of the most recent posted rent-charge JE. Any
 * account that was credited before and is missing now is reported.
 *
 * Scans every org. Never writes.
 *   npx --yes tsx scripts/scan-dropped-recoveries.ts
 */
import dns from 'node:dns';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import mongoose, { Types } from 'mongoose';
import { connectToDatabase } from '../lib/db/mongoose';
import { Lease } from '../lib/db/models/pm/Lease';
import { ChartOfAccount } from '../lib/db/models/pm/ChartOfAccount';
import { JournalEntry } from '../lib/db/models/pm/JournalEntry';
import { Organization } from '../lib/db/models/pm/Organization';
import { resolveScheduledRentForDate } from '../lib/pm/rentSchedule';

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
const ymd = (x: unknown) =>
  x ? new Date(x as string).toISOString().slice(0, 10) : '—';

async function main() {
  loadEnvLocal();
  const servers = process.env.MONGODB_DNS_SERVERS;
  if (servers) dns.setServers(servers.split(',').map((s) => s.trim()));
  await connectToDatabase();

  const orgs = await Organization.find({}).select({ _id: 1, name: 1 }).lean();
  const accounts = await ChartOfAccount.find({})
    .select({ _id: 1, name: 1 })
    .lean<{ _id: Types.ObjectId; name: string }[]>();
  const accName = (id: unknown) =>
    accounts.find((a) => String(a._id) === String(id))?.name ?? String(id);

  let scanned = 0;
  let flagged = 0;

  for (const org of orgs) {
    const leases = await Lease.find({
      organizationId: org._id,
      status: { $in: ['Active', 'Future'] },
      'rentSchedule.0': { $exists: true },
      'primaryRent.nextDueDate': { $ne: null },
    });
    if (leases.length === 0) continue;

    for (const lease of leases) {
      scanned += 1;
      const dueDate = new Date(lease.primaryRent.nextDueDate as Date);

      // What the poster will actually charge next.
      const next = resolveScheduledRentForDate(lease, dueDate);
      const nextAccounts = new Map<string, number>();
      if (next) {
        if ((next.primaryRent?.amount ?? 0) > 0)
          nextAccounts.set(
            String(next.primaryRent.accountId),
            next.primaryRent.amount,
          );
        for (const s of next.splitRentCharges ?? [])
          if (s.amount > 0)
            nextAccounts.set(
              String(s.accountId),
              (nextAccounts.get(String(s.accountId)) ?? 0) + s.amount,
            );
      }

      // What it charged most recently.
      const last = await JournalEntry.findOne({
        organizationId: org._id,
        status: 'Posted',
        memo: `Rent charge for lease #${lease.leaseNumber}`,
      })
        .sort({ date: -1 })
        .lean<{ date: Date; lines: { accountId: Types.ObjectId; credit: number }[] } | null>();
      if (!last) continue;

      const prevAccounts = new Map<string, number>();
      for (const l of last.lines ?? [])
        if ((l.credit ?? 0) > 0)
          prevAccounts.set(
            String(l.accountId),
            (prevAccounts.get(String(l.accountId)) ?? 0) + l.credit,
          );

      const dropped = Array.from(prevAccounts.entries()).filter(
        ([id]) => !nextAccounts.has(id),
      );
      if (dropped.length === 0) continue;

      flagged += 1;
      console.log(
        `\n[!] ${org.name} — lease #${lease.leaseNumber} (${lease._id})`,
      );
      console.log(
        `    last posted ${ymd(last.date)} · next due ${ymd(dueDate)}${
          next ? '' : '  (NOTHING will post — no active Term)'
        }`,
      );
      for (const [id, cents] of dropped)
        console.log(`    DROPS  ${accName(id)}  ${money(cents)}/mo`);
      const kept = Array.from(nextAccounts.entries()).map(
        ([id, c]) => `${accName(id)} ${money(c)}`,
      );
      console.log(`    keeps  ${kept.join(' · ') || '(nothing)'}`);
    }
  }

  console.log(
    `\n${'='.repeat(60)}\nScanned ${scanned} scheduled lease(s); ${flagged} will drop a previously-posted income line.`,
  );
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
