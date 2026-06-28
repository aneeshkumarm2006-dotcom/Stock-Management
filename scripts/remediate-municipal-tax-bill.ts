/**
 * One-shot data fix: remove the stray reversal + voided original journal entries
 * left behind by the OLD "edit a posted bill" flow (reverse + re-post).
 *
 * Background
 * ----------
 * Before the in-place edit fix, editing a posted bill VOIDED its accrual JE and
 * wrote a separate Posted reversal JE, then posted a fresh JE. The P&L sums only
 * Posted rows, so for each edit the bill was left with:
 *   (1) a Voided original JE        — excluded from the P&L (fine on its own)
 *   (2) a Posted reversal JE        — a stray −amount that poisons the P&L
 *   (3) the current Posted JE        — bill.journalEntryId (the one to keep)
 * The stray reversal (2) cancels the new entry (3) out of the Financials.
 *
 * This script deletes (1) and (2) for the affected bill(s) and keeps (3), so the
 * Financials show the correct amount again. Deleting a Voided JE changes no
 * report (voided rows are already excluded); deleting its mirror-twin Posted
 * reversal restores the +amount that the reversal wrongly removed.
 *
 * Safety
 * ------
 * - Preview by default. Pass --apply to actually delete.
 * - Every (original, reversal) pair is cross-validated as genuine mirror twins
 *   (reverse/reversedBy links match, equal totals, same scope, original Voided,
 *   reversal Posted, neither is the bill's kept JE) before any delete. Abort on
 *   any mismatch.
 * - Idempotent: once the strays are gone a re-run finds nothing to do.
 *
 * Usage (run from `site/`):
 *   npx --yes tsx scripts/remediate-municipal-tax-bill.ts --scan
 *   npx --yes tsx scripts/remediate-municipal-tax-bill.ts            # preview the default bill
 *   npx --yes tsx scripts/remediate-municipal-tax-bill.ts --id=<billId>
 *   npx --yes tsx scripts/remediate-municipal-tax-bill.ts --id=<billId> --apply
 *   npx --yes tsx scripts/remediate-municipal-tax-bill.ts --all          # preview EVERY edited bill
 *   npx --yes tsx scripts/remediate-municipal-tax-bill.ts --all --apply  # fix EVERY edited bill
 *
 * Defaults target the known bill: amount 7653886 cents ($76,538.86),
 * memo "2026 Municipal Tax Adjusted". Override with --amount / --memo / --id.
 */
import dns from 'node:dns';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import mongoose, { Types } from 'mongoose';
import { connectToDatabase } from '../lib/db/mongoose';
import { Bill } from '../lib/db/models/pm/Bill';
import { JournalEntry } from '../lib/db/models/pm/JournalEntry';
import { ActivityLogEntry } from '../lib/db/models/pm/ActivityLogEntry';

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

const DEFAULT_AMOUNT = 7653886; // cents — $76,538.86
const DEFAULT_MEMO = '2026 Municipal Tax Adjusted';

interface JeLite {
  _id: Types.ObjectId;
  status: string;
  totalDebits: number;
  totalCredits: number;
  scopeType: string;
  scopeId: Types.ObjectId | null;
  reversesJournalEntryId?: Types.ObjectId | null;
  reversedByJournalEntryId?: Types.ObjectId | null;
}

async function jeById(id: Types.ObjectId | string | null | undefined) {
  if (!id) return null;
  return JournalEntry.findById(id).lean<JeLite | null>();
}

function sameScope(a: JeLite, b: JeLite): boolean {
  return (
    a.scopeType === b.scopeType &&
    String(a.scopeId ?? '') === String(b.scopeId ?? '')
  );
}

/**
 * For one bill, find every (voided original, posted reversal) pair created by
 * the old reverse+repost edits. Sourced from the 'Bill re-posted' activity log
 * (payload.oldJournalEntryId); falls back to scope+amount matching if no log.
 * Returns the validated pairs and the JE to keep, or a reason it's clean.
 */
async function findStrays(bill: {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  amount: number;
  journalEntryId?: Types.ObjectId | null;
}): Promise<
  | { ok: true; keepId: Types.ObjectId | null; pairs: { original: JeLite; reversal: JeLite }[] }
  | { ok: false; reason: string }
> {
  const keepId = bill.journalEntryId ?? null;

  // Collect candidate "original" JE ids (the JEs that were voided during edits).
  const logs = await ActivityLogEntry.find({
    organizationId: bill.organizationId,
    parentType: 'Bill',
    parentId: bill._id,
    eventType: 'Bill re-posted',
  })
    .sort({ createdAt: 1 })
    .lean<{ payload?: Record<string, unknown> }[]>();

  const originalIds = new Set<string>();
  for (const log of logs) {
    const old = log.payload?.oldJournalEntryId;
    if (typeof old === 'string' && old) originalIds.add(old);
  }

  // Fallback: no activity log → match Voided JEs by scope + amount that carry a
  // reversedBy link and are not the kept JE.
  if (originalIds.size === 0) {
    const keep = keepId ? await jeById(keepId) : null;
    const voided = await JournalEntry.find({
      organizationId: bill.organizationId,
      status: 'Voided',
      reversedByJournalEntryId: { $ne: null },
      totalDebits: bill.amount,
    }).lean<JeLite[]>();
    for (const v of voided) {
      if (keepId && String(v._id) === String(keepId)) continue;
      if (keep && !sameScope(v, keep)) continue;
      originalIds.add(String(v._id));
    }
  }

  if (originalIds.size === 0) {
    return { ok: false, reason: 'No reverse+repost history — nothing to clean.' };
  }

  const pairs: { original: JeLite; reversal: JeLite }[] = [];
  for (const oid of Array.from(originalIds)) {
    const original = await jeById(oid);
    if (!original) continue; // already deleted on a prior run
    const reversal = await JournalEntry.findOne({
      organizationId: bill.organizationId,
      reversesJournalEntryId: original._id,
      status: 'Posted',
    }).lean<JeLite | null>();
    if (!reversal) continue; // reversal already gone

    // Cross-validate mirror-twin pair before trusting it.
    const checks: [string, boolean][] = [
      ['original is Voided', original.status === 'Voided'],
      ['reversal is Posted', reversal.status === 'Posted'],
      [
        'reversal.reversesJournalEntryId === original',
        String(reversal.reversesJournalEntryId ?? '') === String(original._id),
      ],
      [
        'original.reversedByJournalEntryId === reversal',
        String(original.reversedByJournalEntryId ?? '') === String(reversal._id),
      ],
      [
        'kept JE is neither original nor reversal',
        !keepId ||
          (String(keepId) !== String(original._id) &&
            String(keepId) !== String(reversal._id)),
      ],
      [
        'equal totals',
        original.totalDebits === reversal.totalDebits &&
          original.totalCredits === reversal.totalCredits,
      ],
      ['same scope', sameScope(original, reversal)],
    ];
    const failed = checks.filter(([, pass]) => !pass).map(([name]) => name);
    if (failed.length > 0) {
      return {
        ok: false,
        reason: `Validation failed for original ${String(original._id)}: ${failed.join('; ')}`,
      };
    }
    pairs.push({ original, reversal });
  }

  if (pairs.length === 0) {
    return { ok: false, reason: 'Strays already removed — nothing to do.' };
  }
  return { ok: true, keepId, pairs };
}

type BillLite = {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  amount: number;
  memo?: string;
  journalEntryId?: Types.ObjectId | null;
};

/** Every bill that was edited under the old reverse+repost flow (has at least
 *  one 'Bill re-posted' activity-log entry), de-duplicated to one per bill. */
async function collectEditedBills(): Promise<BillLite[]> {
  const logs = await ActivityLogEntry.find({
    parentType: 'Bill',
    eventType: 'Bill re-posted',
  }).lean<{ parentId: Types.ObjectId }[]>();

  const seen = new Set<string>();
  const bills: BillLite[] = [];
  for (const l of logs) {
    const key = String(l.parentId);
    if (seen.has(key)) continue;
    seen.add(key);
    const bill = await Bill.findById(l.parentId).lean<BillLite | null>();
    if (bill) bills.push(bill);
  }
  return bills;
}

/** Delete (or, when !apply, just preview) the validated stray pairs for ONE
 *  bill. All mirror-twin validation lives in findStrays; this only ever acts on
 *  pairs it already blessed. A validation failure surfaces via `reason`. */
async function remediateBill(
  bill: BillLite,
  apply: boolean,
): Promise<{ poisoned: boolean; pairs: number; reason?: string }> {
  const res = await findStrays(bill);
  if (!res.ok) return { poisoned: false, pairs: 0, reason: res.reason };

  for (const { original, reversal } of res.pairs) {
    console.log(
      `    • voided original ${String(original._id)} (${original.totalDebits} cents) + posted reversal ${String(reversal._id)} (${reversal.totalDebits} cents)`,
    );
  }

  if (!apply) return { poisoned: true, pairs: res.pairs.length };

  for (const { original, reversal } of res.pairs) {
    await JournalEntry.deleteOne({ _id: reversal._id });
    await JournalEntry.deleteOne({ _id: original._id });
  }
  await ActivityLogEntry.create({
    organizationId: bill.organizationId,
    parentType: 'Bill',
    parentId: bill._id,
    eventType: 'GL remediation — stray reversal removed',
    actorUserId: null,
    payload: {
      keptJournalEntryId: res.keepId ? String(res.keepId) : null,
      deleted: res.pairs.map(({ original, reversal }) => ({
        originalJournalEntryId: String(original._id),
        reversalJournalEntryId: String(reversal._id),
      })),
    },
  });
  return { poisoned: true, pairs: res.pairs.length };
}

async function scan() {
  const bills = await collectEditedBills();
  console.log(`Scanning ${bills.length} edited bill(s) for stray reversals…`);
  let poisoned = 0;
  for (const bill of bills) {
    const res = await findStrays(bill);
    if (res.ok) {
      poisoned++;
      console.log(
        `  ⚠ Bill ${String(bill._id)} ("${bill.memo ?? ''}") — ${res.pairs.length} stray pair(s).`,
      );
    }
  }
  console.log(
    poisoned === 0
      ? '✓ No poisoned bills found.'
      : `Found ${poisoned} poisoned bill(s). Re-run with --all --apply to fix them all (or --id=<billId> --apply one at a time).`,
  );
}

/** Remediate EVERY edited bill in one pass. Preview-by-default; pass --apply to
 *  delete. Each bill is validated independently, so one bill that fails
 *  validation is SKIPPED (reported at the end) without blocking the rest. */
async function fixAll(apply: boolean) {
  const bills = await collectEditedBills();
  console.log(
    `${apply ? 'Remediating' : 'Previewing'} ${bills.length} edited bill(s)…`,
  );
  let poisonedBills = 0;
  let totalPairs = 0;
  const skipped: { id: string; reason: string }[] = [];
  for (const bill of bills) {
    let res;
    try {
      res = await remediateBill(bill, apply);
    } catch (err) {
      skipped.push({ id: String(bill._id), reason: (err as Error).message });
      console.log(`  ✗ Bill ${String(bill._id)} — ERROR: ${(err as Error).message}`);
      continue;
    }
    if (!res.poisoned) {
      if (res.reason && res.reason.startsWith('Validation failed')) {
        skipped.push({ id: String(bill._id), reason: res.reason });
        console.log(`  ✗ Bill ${String(bill._id)} — SKIPPED: ${res.reason}`);
      }
      continue;
    }
    poisonedBills++;
    totalPairs += res.pairs;
    console.log(
      `  ${apply ? '✓ fixed ' : '⚠ would fix'} Bill ${String(bill._id)} ("${bill.memo ?? ''}") — ${res.pairs} pair(s).`,
    );
  }
  console.log(
    apply
      ? `\n✓ Done. Fixed ${poisonedBills} bill(s); deleted ${totalPairs * 2} stray JE(s). Financials should now reflect every bill.`
      : `\n${poisonedBills} bill(s) would be fixed (${totalPairs * 2} stray JE(s) deleted). Re-run with --all --apply to apply.`,
  );
  if (skipped.length > 0) {
    console.log(`\n⚠ ${skipped.length} bill(s) skipped — review manually:`);
    for (const f of skipped) console.log(`  - ${f.id}: ${f.reason}`);
  }
}

async function main() {
  loadEnvLocal();
  const apply = process.argv.includes('--apply');
  const doScan = process.argv.includes('--scan');
  const doAll = process.argv.includes('--all');
  const idArg = argValue('--id');
  const amountArg = Number(argValue('--amount') ?? DEFAULT_AMOUNT);
  const memoArg = argValue('--memo') ?? DEFAULT_MEMO;

  if (process.env.MONGODB_DNS_SERVERS) {
    dns.setServers(
      process.env.MONGODB_DNS_SERVERS.split(',').map((s) => s.trim()),
    );
  }

  await connectToDatabase();
  console.log(`✓ connected${apply ? '' : ' (preview — pass --apply to delete)'}`);

  if (doScan) {
    await scan();
    await mongoose.disconnect();
    return;
  }

  if (doAll) {
    await fixAll(apply);
    await mongoose.disconnect();
    return;
  }

  // Resolve the target bill.
  let bill: {
    _id: Types.ObjectId;
    organizationId: Types.ObjectId;
    amount: number;
    memo?: string;
    journalEntryId?: Types.ObjectId | null;
  } | null;
  if (idArg) {
    if (!Types.ObjectId.isValid(idArg)) {
      throw new Error(`--id is not a valid ObjectId: ${idArg}`);
    }
    bill = await Bill.findById(idArg).lean<typeof bill>();
    if (!bill) throw new Error(`No bill found with _id ${idArg}.`);
  } else {
    const matches = await Bill.find({ amount: amountArg, memo: memoArg }).lean<
      NonNullable<typeof bill>[]
    >();
    if (matches.length === 0) {
      throw new Error(
        `No bill found with amount ${amountArg} cents and memo "${memoArg}". Pass --id=<billId>.`,
      );
    }
    if (matches.length > 1) {
      throw new Error(
        `Ambiguous: ${matches.length} bills match amount ${amountArg} + memo "${memoArg}". Pass --id=<billId> (${matches
          .map((b) => String(b._id))
          .join(', ')}).`,
      );
    }
    bill = matches[0]!;
  }

  console.log(
    `Bill ${String(bill._id)} — memo "${bill.memo ?? ''}", amount ${bill.amount} cents, keep JE ${bill.journalEntryId ? String(bill.journalEntryId) : '(none)'}`,
  );

  const res = await findStrays(bill);
  if (!res.ok) {
    console.log(`Nothing to do: ${res.reason}`);
    await mongoose.disconnect();
    return;
  }

  for (const { original, reversal } of res.pairs) {
    console.log(
      `  • voided original ${String(original._id)} (${original.totalDebits} cents) + posted reversal ${String(reversal._id)} (${reversal.totalDebits} cents)`,
    );
  }

  if (!apply) {
    console.log(
      `Would delete ${res.pairs.length * 2} JE(s) and keep ${res.keepId ? String(res.keepId) : '(none)'}. Re-run with --apply to delete.`,
    );
    await mongoose.disconnect();
    return;
  }

  let deleted = 0;
  for (const { original, reversal } of res.pairs) {
    await JournalEntry.deleteOne({ _id: reversal._id });
    await JournalEntry.deleteOne({ _id: original._id });
    deleted += 2;
  }
  await ActivityLogEntry.create({
    organizationId: bill.organizationId,
    parentType: 'Bill',
    parentId: bill._id,
    eventType: 'GL remediation — stray reversal removed',
    actorUserId: null,
    payload: {
      keptJournalEntryId: res.keepId ? String(res.keepId) : null,
      deleted: res.pairs.map(({ original, reversal }) => ({
        originalJournalEntryId: String(original._id),
        reversalJournalEntryId: String(reversal._id),
      })),
    },
  });
  console.log(
    `✓ Deleted ${deleted} stray JE(s); kept ${res.keepId ? String(res.keepId) : '(none)'}. Financials should now reflect the bill.`,
  );

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('Remediation failed:', err);
  process.exitCode = 1;
});
