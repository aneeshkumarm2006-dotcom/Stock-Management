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
import type { IRecurringTransaction } from '@/lib/db/models/pm/RecurringTransaction';
import type { RecurringFrequency } from '@/types/pm';

function advanceNextDate(
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
      dueDate: rule.nextDate,
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
 * Process due RecurringTransactions for one org and return per-rule results.
 * Pass `now` to control "today" in tests.
 */
export async function runRecurringPoster(
  now: Date = new Date(),
): Promise<PostOneResult[]> {
  await connectToDatabase();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  const candidates = await RecurringTransaction.find({
    active: true,
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

    try {
      const artifact = await postArtifact(rule);
      if (!artifact) {
        results.push({
          recurringTransactionId: String(rule._id),
          posted: false,
          note: 'Skipped (unsupported type or missing accounts)',
        });
        continue;
      }

      rule.lastPostedDate = rule.nextDate;
      rule.postedCount = (rule.postedCount ?? 0) + 1;
      rule.nextDate = advanceNextDate(rule.nextDate, rule.frequency);

      if (
        rule.duration === 'End after N' &&
        typeof rule.occurrenceCount === 'number' &&
        rule.postedCount >= rule.occurrenceCount
      ) {
        rule.active = false;
      }

      await rule.save();

      results.push({
        recurringTransactionId: String(rule._id),
        posted: true,
        artifactKind: artifact.kind,
        artifactId: String(artifact.id),
      });
    } catch (err) {
      results.push({
        recurringTransactionId: String(rule._id),
        posted: false,
        note: err instanceof Error ? err.message : 'Posting failed',
      });
    }
  }
  return results;
}
