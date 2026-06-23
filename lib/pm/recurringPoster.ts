// recurringPoster — worker that scans active RecurringTransactions and
// auto-posts the appropriate record (Bill / Check / JE) when
// `nextDate - postNDaysInAdvance <= today` AND `lastPostedDate < nextDate`
// (BR-AC-8).
//
// Edits to a recurring rule are non-retroactive (DECISIONS.md Phase 4) — the
// worker only consults current state for *future* postings.
//
// For Phase 4 the worker creates a draft Bill (for type=Bill) or a placeholder
// JournalEntry (for type='Journal entry'). Type='Check' falls back to the
// Bill path with `queueForPrinting=true` so the BillPayment surface can
// surface the check queue later (full Print queue ships Phase 9).
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { RecurringTransaction } from '@/lib/db/models/pm/RecurringTransaction';
import { Bill } from '@/lib/db/models/pm/Bill';
import { JournalEntry } from '@/lib/db/models/pm/JournalEntry';
import { assertWriteAllowed, LockedPeriodError } from '@/lib/pm/lockedPeriod';
import type { IRecurringTransaction } from '@/lib/db/models/pm/RecurringTransaction';
import type { PmContext } from '@/lib/auth/getCurrentUser';
import type { RecurringFrequency } from '@/types/pm';

export function advanceNextDate(
  current: Date,
  frequency: RecurringFrequency,
): Date {
  const next = new Date(current);
  switch (frequency) {
    case 'Weekly':
      next.setDate(next.getDate() + 7);
      break;
    case 'Monthly':
      next.setMonth(next.getMonth() + 1);
      break;
    case 'Quarterly':
      next.setMonth(next.getMonth() + 3);
      break;
    case 'Yearly':
      next.setFullYear(next.getFullYear() + 1);
      break;
  }
  return next;
}

interface PostOneResult {
  recurringTransactionId: string;
  posted: boolean;
  artifactKind?: 'Bill' | 'JournalEntry';
  artifactId?: string;
  note?: string;
}

async function postArtifact(
  rule: IRecurringTransaction,
): Promise<{ kind: 'Bill' | 'JournalEntry'; id: Types.ObjectId } | null> {
  const total = rule.amounts.reduce((s, a) => s + a.amount, 0);
  if (rule.type === 'Bill' || rule.type === 'Check') {
    const bill = await Bill.create({
      organizationId: rule.organizationId,
      vendorId:
        rule.payee?.type === 'Vendor' ? rule.payee.id : null,
      invoiceDate: rule.nextDate,
      status: 'Draft',
      memo: rule.memo,
      lines: rule.amounts.map((a) => ({
        accountId: a.accountId,
        description: a.description,
        amount: a.amount,
      })),
      scope:
        rule.amounts[0]?.scopeType === 'Property' && rule.amounts[0]?.scopeId
          ? { type: 'Property', id: rule.amounts[0].scopeId }
          : { type: 'Company', id: null },
      createdBy: rule.type === 'Check' ? 'Recurring check' : 'Recurring bill',
      createdByUserId: rule.createdByUserId,
    });
    return { kind: 'Bill', id: bill._id };
  }
  if (rule.type === 'Journal entry') {
    // JE needs balanced lines; the rule.amounts grid is treated as the credit
    // side, with a single debit to the first row's account so the entry
    // balances. This is intentionally minimal — a full JE recurring rule UI
    // lands in Phase 9's RecurringTransaction full editor.
    const firstRow = rule.amounts[0];
    if (!firstRow) return null;
    const lines = rule.amounts.map((a) => ({
      accountId: a.accountId,
      scopeType: a.scopeType,
      scopeId: a.scopeId,
      unitId: a.unitId,
      description: a.description,
      debit: 0,
      credit: a.amount,
    }));
    const je = await JournalEntry.create({
      organizationId: rule.organizationId,
      date: rule.nextDate,
      scopeType: 'Company',
      scopeId: null,
      memo: rule.memo ?? 'Recurring journal entry',
      lines: [
        ...lines,
        {
          accountId: firstRow.accountId,
          scopeType: 'Company',
          scopeId: null,
          unitId: null,
          description: 'Auto-balance placeholder',
          debit: total,
          credit: 0,
        },
      ],
      status: 'Draft',
      createdByUserId: rule.createdByUserId,
    });
    return { kind: 'JournalEntry', id: je._id };
  }
  return null;
}

/**
 * Process due RecurringTransactions for ONE organization and return per-rule
 * results. Pass `now` to control "today" in tests.
 *
 * DEL-003 fixes three defects:
 *   1. Org isolation — the candidate query is now filtered by `organizationId`
 *      so a cron sweep can never touch another tenant's rules. The cron loops
 *      over active orgs and calls this once per org.
 *   2. Locked-period enforcement — each due rule's `nextDate` is checked with
 *      `assertWriteAllowed` (system context, no override) BEFORE any artifact
 *      is written; rules landing inside a locked window are skipped, not posted.
 *   3. Concurrency — the `lastPostedDate`/`nextDate` bump is performed with an
 *      atomic `findOneAndUpdate` guarded on the rule's CURRENT
 *      (nextDate, lastPostedDate). Two concurrent cron runs therefore collapse
 *      to a single write: only the run that wins the atomic claim posts; the
 *      loser's filter no longer matches and it skips.
 */
export async function runRecurringPoster(
  orgId: string,
  now: Date = new Date(),
): Promise<PostOneResult[]> {
  await connectToDatabase();
  if (!Types.ObjectId.isValid(orgId)) {
    throw new Error('runRecurringPoster requires a valid orgId.');
  }
  const orgObjectId = new Types.ObjectId(orgId);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  // System context for the locked-period gate. A cron has no human roles, so
  // it can NEVER override a lock (no FinancialAdministrator/Admin) — locked
  // periods must hold against automated posting.
  const systemCtx: PmContext = {
    userId: String(orgObjectId),
    orgId,
    roles: [],
    impersonatedBy: null,
  };

  const candidates = await RecurringTransaction.find({
    active: true,
    organizationId: orgObjectId,
  });

  const results: PostOneResult[] = [];
  for (const rule of candidates) {
    const triggerDate = new Date(rule.nextDate);
    triggerDate.setDate(triggerDate.getDate() - rule.postNDaysInAdvance);
    triggerDate.setHours(0, 0, 0, 0);
    const lastPosted = rule.lastPostedDate
      ? new Date(rule.lastPostedDate)
      : null;
    if (lastPosted && lastPosted >= rule.nextDate) {
      // Already posted for this nextDate; skip.
      results.push({
        recurringTransactionId: String(rule._id),
        posted: false,
        note: 'Already posted',
      });
      continue;
    }
    if (today < triggerDate) {
      results.push({
        recurringTransactionId: String(rule._id),
        posted: false,
        note: 'Not yet due',
      });
      continue;
    }

    // Locked-period gate — block posting into a locked accounting period.
    const scopePropertyId =
      rule.amounts[0]?.scopeType === 'Property' && rule.amounts[0]?.scopeId
        ? String(rule.amounts[0].scopeId)
        : null;
    try {
      await assertWriteAllowed({
        orgId,
        txnDate: new Date(rule.nextDate),
        scopePropertyId,
        ctx: systemCtx,
      });
    } catch (err) {
      if (err instanceof LockedPeriodError) {
        results.push({
          recurringTransactionId: String(rule._id),
          posted: false,
          note: `Locked period: ${err.policyMessage}`,
        });
        continue;
      }
      throw err;
    }

    // Atomically CLAIM this nextDate before posting so concurrent cron runs
    // can't double-post. The filter pins the rule's current state; only one
    // racer matches and advances it.
    const claimedNextDate = advanceNextDate(rule.nextDate, rule.frequency);
    const willEnd =
      rule.duration === 'End after N' &&
      typeof rule.occurrenceCount === 'number' &&
      (rule.postedCount ?? 0) + 1 >= rule.occurrenceCount;
    const claim = await RecurringTransaction.findOneAndUpdate(
      {
        _id: rule._id,
        organizationId: orgObjectId,
        active: true,
        nextDate: rule.nextDate,
        // Guard: only claim when this nextDate has not already been posted.
        $or: [
          { lastPostedDate: null },
          { lastPostedDate: { $lt: rule.nextDate } },
        ],
      },
      {
        $set: {
          lastPostedDate: rule.nextDate,
          nextDate: claimedNextDate,
          ...(willEnd ? { active: false } : {}),
        },
        $inc: { postedCount: 1 },
      },
      { new: false },
    );
    if (!claim) {
      // Another concurrent run already claimed this nextDate.
      results.push({
        recurringTransactionId: String(rule._id),
        posted: false,
        note: 'Already claimed by a concurrent run',
      });
      continue;
    }

    try {
      // Post using the CLAIMED state (the pre-update snapshot in `claim` still
      // carries the nextDate we are posting against).
      const artifact = await postArtifact(claim);
      if (!artifact) {
        // Unsupported type / missing accounts — release the claim so a later
        // run can retry once the rule is fixed.
        await RecurringTransaction.updateOne(
          { _id: rule._id, organizationId: orgObjectId },
          {
            $set: {
              lastPostedDate: claim.lastPostedDate ?? null,
              nextDate: claim.nextDate,
              active: claim.active,
            },
            $inc: { postedCount: -1 },
          },
        );
        results.push({
          recurringTransactionId: String(rule._id),
          posted: false,
          note: 'Skipped (unsupported type or missing accounts)',
        });
        continue;
      }

      results.push({
        recurringTransactionId: String(rule._id),
        posted: true,
        artifactKind: artifact.kind,
        artifactId: String(artifact.id),
      });
    } catch (err) {
      // Posting failed after the claim — roll the claim back so the rule
      // re-fires on the next run rather than silently skipping a period.
      await RecurringTransaction.updateOne(
        { _id: rule._id, organizationId: orgObjectId },
        {
          $set: {
            lastPostedDate: claim.lastPostedDate ?? null,
            nextDate: claim.nextDate,
            active: claim.active,
          },
          $inc: { postedCount: -1 },
        },
      );
      results.push({
        recurringTransactionId: String(rule._id),
        posted: false,
        note: err instanceof Error ? err.message : 'Posting failed',
      });
    }
  }
  return results;
}
