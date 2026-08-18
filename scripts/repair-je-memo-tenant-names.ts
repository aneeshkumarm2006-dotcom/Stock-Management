/**
 * One-shot data fix: rewrite lease-generated journal-entry memos so they lead
 * with the TENANT NAME instead of a bare lease number.
 *
 * Background
 * ----------
 * Rent accruals posted as `Rent charge for lease #11`, which forces anyone
 * reading the General Ledger to open the lease to learn who the charge is for.
 * The posters now emit `Salon Barber Triple V — rent charge (lease #11)` via
 * `lib/pm/journalMemo.ts`. That only affects entries posted from here on; this
 * script brings the existing history onto the same format so the GL isn't split
 * between two conventions for months.
 *
 * What it touches
 * ---------------
 * ONLY the `memo` string, and only on entries whose memo matches the old
 * `(Rent|Recurring) charge for lease #N` shape. Amounts, dates, lines, status,
 * postedAt and every other field are left exactly as they were — this is a
 * relabelling, not an accounting change, so it deliberately does NOT go through
 * the locked-period gate.
 *
 * Memos are rebuilt with the SAME builders the posters use, so a backfilled row
 * and a freshly-posted one are byte-identical.
 *
 * The literal `lease #N` substring is preserved. `JournalEntry` has no
 * `leaseId` field, so that substring is the only link from an entry back to its
 * lease — `scan-rent-issues.ts`, `fix-duplicate-firstmonth-rent.ts` and
 * `backfill-historical-rent.ts` all regex it out and would break without it.
 *
 * Anything trailing the lease number is carried across: `backfill-historical-
 * rent.ts` wrote `... #N (backfill)`, and the recurring-charge memos carry the
 * charge's own detail in `(...)`.
 *
 * Safety
 * ------
 * - Preview by default. Pass --apply to write.
 * - --scan lists every candidate without writing.
 * - Skips (and reports) any entry whose lease is missing or has no tenant, so a
 *   tenant-less lease keeps its old memo rather than gaining a dangling dash.
 *   Fix the lease's tenants and re-run to pick it up.
 * - Idempotent: the new format no longer matches the old regex, so a re-run
 *   finds nothing.
 * - Voided entries are included so the list stays uniform when "Include voided
 *   entries" is ticked.
 * - Every change is written to the activity log.
 *
 * Usage (run from `site/`):
 *   npx --yes tsx scripts/repair-je-memo-tenant-names.ts --scan
 *   npx --yes tsx scripts/repair-je-memo-tenant-names.ts                # preview
 *   npx --yes tsx scripts/repair-je-memo-tenant-names.ts --apply        # write
 *   npx --yes tsx scripts/repair-je-memo-tenant-names.ts --org=ORGID    # one org
 *   npx --yes tsx scripts/repair-je-memo-tenant-names.ts --id=JEID      # one entry
 */
import dns from 'node:dns';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import mongoose, { Types } from 'mongoose';
import { connectToDatabase } from '../lib/db/mongoose';
import { Lease } from '../lib/db/models/pm/Lease';
import { JournalEntry } from '../lib/db/models/pm/JournalEntry';
import { ActivityLogEntry } from '../lib/db/models/pm/ActivityLogEntry';
import {
  leaseTenantsLabel,
  recurringChargeMemo,
  rentChargeMemo,
  type LeaseTenantLike,
} from '../lib/pm/journalMemo';

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

// The two legacy memo shapes, and the tail that must survive the rewrite:
//   "Rent charge for lease #11"
//   "Rent charge for lease #11 (backfill)"
//   "Recurring charge for lease #11 (Monthly)"
const LEGACY_MEMO = /^(Rent|Recurring) charge for lease #(\d+)\b\s*(.*)$/;
// Mongo-side prefilter; the precise parse happens in JS with the regex above.
const LEGACY_MEMO_QUERY = /^(Rent|Recurring) charge for lease #\d+/;

interface JeLite {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  memo?: string;
  status?: string;
}

interface LeaseLite {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  leaseNumber: number;
  tenants?: LeaseTenantLike[];
}

type PlanOk = {
  ok: true;
  je: JeLite;
  from: string;
  to: string;
  leaseId: Types.ObjectId;
};
type PlanSkip = { ok: false; je: JeLite; from: string; reason: string };
type Plan = PlanOk | PlanSkip;

/** Key a lease by org + number — leaseNumber is only unique within an org. */
function leaseKey(orgId: unknown, leaseNumber: number | string): string {
  return `${String(orgId)}:${leaseNumber}`;
}

/** Work out the new memo for one entry, or why it can't be rewritten.
 *  Returns null when the entry needs no change at all. */
function planRewrite(je: JeLite, leases: Map<string, LeaseLite>): Plan | null {
  const from = je.memo ?? '';
  const m = from.match(LEGACY_MEMO);
  if (!m) return null; // not a legacy lease memo — leave it alone

  const kind = m[1] ?? '';
  const leaseNumber = m[2] ?? '';
  const tail = (m[3] ?? '').trim();
  if (!leaseNumber) return null;

  const lease = leases.get(leaseKey(je.organizationId, leaseNumber));
  if (!lease) {
    return {
      ok: false,
      je,
      from,
      reason: `no lease #${leaseNumber} in this org`,
    };
  }
  const tenantLabel = leaseTenantsLabel(lease.tenants);
  if (!tenantLabel) {
    return {
      ok: false,
      je,
      from,
      reason: `lease #${leaseNumber} has no tenant to name`,
    };
  }

  // The recurring-charge tail IS the charge detail and belongs inside the new
  // memo's body; the rent-charge tail is an opaque marker and rides along.
  const to =
    kind === 'Recurring'
      ? recurringChargeMemo({
          leaseNumber,
          tenantLabel,
          detail: tail.replace(/^\((.*)\)$/, '$1'),
        })
      : rentChargeMemo({ leaseNumber, tenantLabel, suffix: tail });

  if (to === from) return null; // already current
  return { ok: true, je, from, to, leaseId: lease._id };
}

async function main() {
  loadEnvLocal();
  const apply = process.argv.includes('--apply');
  const doScan = process.argv.includes('--scan');
  const orgArg = argValue('--org');
  const idArg = argValue('--id');

  if (process.env.MONGODB_DNS_SERVERS) {
    dns.setServers(
      process.env.MONGODB_DNS_SERVERS.split(',').map((s) => s.trim()),
    );
  }

  await connectToDatabase();
  console.log(`connected${apply ? '' : ' (preview — pass --apply to write)'}`);

  const filter: Record<string, unknown> = { memo: LEGACY_MEMO_QUERY };
  if (orgArg) {
    if (!Types.ObjectId.isValid(orgArg)) {
      throw new Error(`--org is not a valid ObjectId: ${orgArg}`);
    }
    filter.organizationId = new Types.ObjectId(orgArg);
  }
  if (idArg) {
    if (!Types.ObjectId.isValid(idArg)) {
      throw new Error(`--id is not a valid ObjectId: ${idArg}`);
    }
    filter._id = new Types.ObjectId(idArg);
    // Drop the memo prefilter so a targeted entry reports WHY it is skipped
    // instead of silently matching nothing.
    delete filter.memo;
  }

  const entries = await JournalEntry.find(filter)
    .select({ organizationId: 1, memo: 1, status: 1 })
    .lean<JeLite[]>();
  console.log(`Matched ${entries.length} journal entry(ies) with a legacy memo.`);
  if (entries.length === 0) {
    await mongoose.disconnect();
    return;
  }

  // Batch-load every lease those memos name — one query per org, no per-row
  // lookups.
  const wanted = new Map<string, Set<number>>();
  for (const je of entries) {
    const m = (je.memo ?? '').match(LEGACY_MEMO);
    if (!m) continue;
    const num = Number(m[2]);
    if (!Number.isFinite(num)) continue;
    const org = String(je.organizationId);
    const set = wanted.get(org) ?? new Set<number>();
    set.add(num);
    wanted.set(org, set);
  }
  const leases = new Map<string, LeaseLite>();
  for (const [org, numbers] of Array.from(wanted)) {
    const found = await Lease.find({
      organizationId: new Types.ObjectId(org),
      leaseNumber: { $in: Array.from(numbers) },
    })
      .select({ organizationId: 1, leaseNumber: 1, tenants: 1 })
      .lean<LeaseLite[]>();
    for (const l of found) {
      leases.set(leaseKey(l.organizationId, l.leaseNumber), l);
    }
  }

  const plans: Plan[] = [];
  for (const je of entries) {
    const p = planRewrite(je, leases);
    if (p) plans.push(p);
  }
  const rewrites = plans.filter((p): p is PlanOk => p.ok);
  const skips = plans.filter((p): p is PlanSkip => !p.ok);

  for (const p of rewrites) {
    console.log(`  - ${p.from}\n    -> ${p.to}`);
  }
  for (const p of skips) {
    console.log(`  ! skipped "${p.from}" — ${p.reason}`);
  }

  if (doScan) {
    console.log(
      `\nScan complete: ${rewrites.length} would be rewritten, ${skips.length} skipped.` +
        `\nRe-run without --scan to preview, or with --apply to write.`,
    );
    await mongoose.disconnect();
    return;
  }

  if (!apply) {
    console.log(
      `\n${rewrites.length} memo(s) would be rewritten (${skips.length} skipped). Re-run with --apply to write.`,
    );
    await mongoose.disconnect();
    return;
  }

  let changed = 0;
  for (const p of rewrites) {
    await JournalEntry.updateOne(
      { _id: p.je._id, organizationId: p.je.organizationId },
      { $set: { memo: p.to } },
      { runValidators: true },
    );
    await ActivityLogEntry.create({
      organizationId: p.je.organizationId,
      parentType: 'JournalEntry',
      parentId: p.je._id,
      eventType: 'Data repair — memo relabelled with tenant name',
      actorUserId: null,
      payload: { from: p.from, to: p.to, leaseId: String(p.leaseId) },
    });
    changed++;
  }

  console.log(
    `\nDone. Rewrote ${changed} memo(s); ${skips.length} skipped. Amounts, dates and statuses were not touched.`,
  );
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
