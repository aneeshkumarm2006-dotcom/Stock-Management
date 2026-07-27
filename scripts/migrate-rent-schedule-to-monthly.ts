/**
 * ONE-OFF migration: lease rent-schedule periods move from per-sqft RATES to
 * MONTHLY AMOUNTS.
 *
 * Background — the schedule editor was labelled "Base Rent $/SF/YR" and derived
 * the posted rent as `rate x sizeSqft / 12`. Every value the client actually
 * typed was a MONTHLY DOLLAR amount (e.g. 3719.25 = $3,719.25/month), so the
 * app inflated it into six-figure "rent" ($1,024,653.38/mo on lease #8) and
 * overwrote each lease's primaryRent/splitRentCharges with that figure.
 *
 * This script:
 *   1. Renames each period's rate fields to the new monthly-cents fields:
 *        baseRatePerSqft (dollars) -> baseMonthlyAmount (cents) = round(v*100)
 *        opexRatePerSqft           -> opexMonthlyAmount
 *        taxRatePerSqft            -> taxMonthlyAmount
 *      `sizeSqft` is preserved untouched (now informational only).
 *   2. Re-syncs primaryRent + splitRentCharges from the period ACTIVE TODAY, so
 *      the rent roll / lease list / Edit-lease Revenue rows show the amounts the
 *      client entered again. `primaryRent.nextDueDate` (the posting cursor) is
 *      always preserved.
 *   3. When NO Term period covers today (the schedule can't say what the current
 *      rent is), rebuilds primaryRent from that lease's most recent POSTED rent
 *      charge instead — the last known-good rent, straight off the ledger — so
 *      the inflated figure doesn't survive anywhere.
 *
 * Idempotent: a period already carrying `baseMonthlyAmount` is skipped.
 *
 * Dry run (default):  npx --yes tsx scripts/migrate-rent-schedule-to-monthly.ts
 * Apply:              npx --yes tsx scripts/migrate-rent-schedule-to-monthly.ts --apply
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

const APPLY = process.argv.includes('--apply');
const money = (c: number) => `$${(c / 100).toFixed(2)}`;
const ymd = (x: unknown) => (x ? new Date(x as string).toISOString().slice(0, 10) : '—');

interface LegacyPeriod {
  label?: string;
  kind?: string;
  startDate?: Date;
  endDate?: Date;
  sizeSqft?: number;
  baseRatePerSqft?: number;
  opexRatePerSqft?: number;
  taxRatePerSqft?: number;
  baseMonthlyAmount?: number;
  opexMonthlyAmount?: number;
  taxMonthlyAmount?: number;
  baseAccountId?: mongoose.Types.ObjectId | null;
  opexAccountId?: mongoose.Types.ObjectId | null;
  taxAccountId?: mongoose.Types.ObjectId | null;
  [k: string]: unknown;
}

/** dollars (as typed by the client) -> integer cents */
const dollarsToCents = (v: unknown) => Math.round((Number(v) || 0) * 100);

/** The Term row covering `date`, inclusive on both ends. Mirrors
 *  `activeTermPeriodForDate` in lib/pm/rentSchedule.ts. */
function activeTerm(periods: LegacyPeriod[], date: Date): LegacyPeriod | null {
  const t = date.getTime();
  for (const p of periods) {
    if ((p.kind ?? 'Term') !== 'Term') continue;
    const s = p.startDate ? new Date(p.startDate).getTime() : null;
    const e = p.endDate ? new Date(p.endDate).getTime() : null;
    if (s !== null && t < s) continue;
    if (e !== null && t > e) continue;
    return p;
  }
  return null;
}

async function main() {
  loadEnvLocal();
  if (process.env.MONGODB_DNS_SERVERS)
    dns.setServers(process.env.MONGODB_DNS_SERVERS.split(',').map((s) => s.trim()));
  await connectToDatabase();
  const db = mongoose.connection.db;
  if (!db) throw new Error('no db handle');

  const today = new Date();
  console.log(
    `\n${APPLY ? '*** APPLYING ***' : '--- DRY RUN (pass --apply to write) ---'}  today=${ymd(today)}\n`,
  );

  const needsAttention: string[] = [];

  for (const coll of ['pm_leases', 'pm_draft_leases'] as const) {
    const docs = await db
      .collection(coll)
      .find({ rentSchedule: { $exists: true, $ne: [] } })
      .toArray();
    console.log(`===== ${coll}: ${docs.length} doc(s) with a schedule =====`);

    for (const doc of docs) {
      const num = doc.leaseNumber ?? doc.draftNumber ?? '?';
      const periods = (doc.rentSchedule ?? []) as LegacyPeriod[];
      const alreadyMigrated = periods.every((p) => p.baseMonthlyAmount !== undefined);
      if (alreadyMigrated) {
        console.log(`  #${num}: already migrated — skipped`);
        continue;
      }

      const converted = periods.map((p) => {
        const next: LegacyPeriod = { ...p };
        next.baseMonthlyAmount =
          p.baseMonthlyAmount ?? dollarsToCents(p.baseRatePerSqft);
        next.opexMonthlyAmount =
          p.opexMonthlyAmount ?? dollarsToCents(p.opexRatePerSqft);
        next.taxMonthlyAmount = p.taxMonthlyAmount ?? dollarsToCents(p.taxRatePerSqft);
        delete next.baseRatePerSqft;
        delete next.opexRatePerSqft;
        delete next.taxRatePerSqft;
        return next;
      });

      console.log(`  --- #${num} (${doc._id}) status=${doc.status}`);
      converted.forEach((p, i) => {
        const old = periods[i] as LegacyPeriod;
        console.log(
          `      [${p.kind}] "${p.label}" ${ymd(p.startDate)}→${ymd(p.endDate)}: ` +
            `base ${old.baseRatePerSqft ?? 0} → ${money(p.baseMonthlyAmount ?? 0)}/mo, ` +
            `opex ${old.opexRatePerSqft ?? 0} → ${money(p.opexMonthlyAmount ?? 0)}/mo, ` +
            `tax ${old.taxRatePerSqft ?? 0} → ${money(p.taxMonthlyAmount ?? 0)}/mo`,
        );
      });

      const update: Record<string, unknown> = { rentSchedule: converted };

      // Re-sync the resolved current rent from the ACTIVE term (leases only —
      // drafts resolve theirs at execution time).
      if (coll === 'pm_leases') {
        const term = activeTerm(converted, today);
        const oldTotal =
          Number(doc.primaryRent?.amount ?? 0) +
          ((doc.splitRentCharges ?? []) as { amount?: number }[]).reduce(
            (s, c) => s + Number(c.amount ?? 0),
            0,
          );
        if (!term) {
          // No period covers today, so the schedule can't state the current
          // rent. Fall back to the last POSTED rent charge for this lease —
          // the amounts actually billed before the schedule overwrote them.
          const lastRentJe = await db
            .collection('pm_journal_entries')
            .find({
              memo: `Rent charge for lease #${num}`,
              status: 'Posted',
            })
            .sort({ date: -1 })
            .limit(1)
            .toArray();
          const credits = ((lastRentJe[0]?.lines ?? []) as {
            accountId?: mongoose.Types.ObjectId;
            credit?: number;
            description?: string;
          }[])
            .filter((l) => Number(l.credit ?? 0) > 0)
            .sort((a, b) => Number(b.credit ?? 0) - Number(a.credit ?? 0));

          if (credits.length === 0) {
            needsAttention.push(
              `Lease #${num}: no Term period covers ${ymd(today)} AND no posted rent ` +
                `charge to fall back on — primaryRent left at ` +
                `${money(Number(doc.primaryRent?.amount ?? 0))}/mo. Needs a manual rent entry.`,
            );
            console.log(`      ! no active term and no posted rent charge — left untouched`);
          } else {
            // Prefer the line on the lease's existing base income account;
            // otherwise the largest credit is the base rent.
            const primaryIdx = Math.max(
              0,
              credits.findIndex(
                (l) => String(l.accountId) === String(doc.primaryRent?.accountId),
              ),
            );
            const primary = credits[primaryIdx]!;
            update.primaryRent = {
              amount: Number(primary.credit ?? 0),
              accountId: primary.accountId,
              rentMethod: 'Fixed',
              ratePerSqftCents: 0,
              nextDueDate: doc.primaryRent?.nextDueDate ?? null,
              memo: doc.primaryRent?.memo ?? 'Base rent',
            };
            update.splitRentCharges = credits
              .filter((_, i) => i !== primaryIdx)
              .map((l) => ({
                accountId: l.accountId,
                amount: Number(l.credit ?? 0),
                memo: l.description ?? '',
              }));
            const newTotal = credits.reduce((s, l) => s + Number(l.credit ?? 0), 0);
            console.log(
              `      rent: ${money(oldTotal)}/mo → ${money(newTotal)}/mo ` +
                `(restored from the ${ymd(lastRentJe[0]?.date)} posted rent charge; ` +
                `nextDueDate ${ymd(doc.primaryRent?.nextDueDate)} preserved)`,
            );
            needsAttention.push(
              `Lease #${num}: its schedule's last Term ends before today, so NO rent will ` +
                `post from the schedule. primaryRent was restored to ${money(newTotal)}/mo ` +
                `from the ledger, but the client must add a Term period covering the ` +
                `current lease dates (or clear the schedule) for rent to post again.`,
            );
          }
        } else if (!term.baseAccountId) {
          needsAttention.push(
            `Lease #${num}: active term "${term.label}" has no base income account — ` +
              `primaryRent left untouched.`,
          );
          console.log(`      ! active term has no base income account — primaryRent left untouched`);
        } else {
          const splits: {
            accountId: mongoose.Types.ObjectId;
            amount: number;
            memo: string;
          }[] = [];
          if ((term.opexMonthlyAmount ?? 0) > 0 && term.opexAccountId) {
            splits.push({
              accountId: term.opexAccountId,
              amount: term.opexMonthlyAmount ?? 0,
              memo: 'OPEX Recovery',
            });
          }
          if ((term.taxMonthlyAmount ?? 0) > 0 && term.taxAccountId) {
            splits.push({
              accountId: term.taxAccountId,
              amount: term.taxMonthlyAmount ?? 0,
              memo: 'Tax Recovery',
            });
          }
          update.primaryRent = {
            amount: term.baseMonthlyAmount ?? 0,
            accountId: term.baseAccountId,
            rentMethod: 'Fixed',
            ratePerSqftCents: 0,
            // PRESERVE the posting cursor — never rewind it.
            nextDueDate: doc.primaryRent?.nextDueDate ?? null,
            memo: `Base rent — ${term.label}`,
          };
          update.splitRentCharges = splits;
          const newTotal =
            (term.baseMonthlyAmount ?? 0) + splits.reduce((s, c) => s + c.amount, 0);
          console.log(
            `      rent: ${money(oldTotal)}/mo → ${money(newTotal)}/mo ` +
              `(active term "${term.label}"; nextDueDate ${ymd(doc.primaryRent?.nextDueDate)} preserved)`,
          );
        }
      }

      if (APPLY) {
        await db.collection(coll).updateOne({ _id: doc._id }, { $set: update });
        console.log(`      ✓ written`);
      }
    }
  }

  if (needsAttention.length) {
    console.log(`\n===== NEEDS ATTENTION =====`);
    for (const n of needsAttention) console.log(`  • ${n}`);
  }

  console.log(`\n${APPLY ? 'Done.' : 'Dry run complete — nothing written.'}`);
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
