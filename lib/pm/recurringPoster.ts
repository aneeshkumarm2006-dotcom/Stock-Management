// recurringPoster — worker that scans active RecurringTransactions and
// auto-posts the appropriate record (Bill / Check / JE) when
// `nextDate - postNDaysInAdvance <= today` AND `lastPostedDate < nextDate`
// (BR-AC-8).
//
// Edits to a recurring rule are non-retroactive (DECISIONS.md Phase 4) — the
// worker only consults current state for *future* postings.
//
// The worker creates Bills (for type=Bill/Check) or a JournalEntry (for
// type='Journal entry'). Type='Check' falls back to the Bill path with
// `queueForPrinting=true` so the BillPayment surface can surface the check
// queue later (full Print queue ships Phase 9).
//
// Generated Bills are recorded as **Due** and posted straight to the ledger,
// exactly like a manually recorded bill. They used to be created as `Draft`,
// which meant they never reached Financials AND were hidden behind the Bills
// page's non-default "Drafts" tab — so a correctly-firing rule looked to the
// user like it had generated nothing at all.
//
// SCOPE. A rule's amount lines each carry their own Property/Company scope.
// Since a Bill's scope is a single {type,id}, a rule spanning several
// properties posts one Bill per property (`groupAmountsByScope`). Recurring
// JEs balance per scope for the same reason. This all used to read
// `amounts[0]` only, which silently dumped a whole multi-property rule onto
// the first row's property.
//
// CATCH-UP. `runRecurringPoster` posts exactly one period per rule per run by
// default (the cron's contract). Pass `opts.throughDate` to walk a rule
// forward through several periods in one run — see PosterOptions.
//
// IDEMPOTENCY. Three layers: the atomic claim below, a partial unique index on
// (organizationId, recurringTransactionId, recurringPeriodDate) over Bill and
// JournalEntry, and an advisory duplicate scan surfaced by the dry run.
import { Types } from "mongoose";
import { connectToDatabase } from "@/lib/db/mongoose";
import { RecurringTransaction } from "@/lib/db/models/pm/RecurringTransaction";
import { Bill } from "@/lib/db/models/pm/Bill";
import { JournalEntry } from "@/lib/db/models/pm/JournalEntry";
import { Property } from "@/lib/db/models/pm/Property";
import { assertWriteAllowed, LockedPeriodError } from "@/lib/pm/lockedPeriod";
import { postBillToLedger } from "@/lib/pm/postBillToLedger";
import { resolveBankCashAccountId } from "@/lib/pm/postBillPaymentToLedger";
import type { IRecurringTransaction } from "@/lib/db/models/pm/RecurringTransaction";
import type { PmContext } from "@/lib/auth/getCurrentUser";
import type { RecurringFrequency } from "@/types/pm";

/**
 * Shift `current` by `months`, clamping the day to the target month's length.
 *
 * `setMonth` alone overflows: Jan 31 + 1 month yields **Mar 3**, not Feb 28 —
 * so a rule anchored on the 29th–31st silently SKIPS February altogether. That
 * was near-invisible while the poster advanced at most once per day; a
 * multi-period catch-up compounds it into a whole missing month.
 *
 * Known limitation: the rule stores only a moving `nextDate` cursor, no
 * original anchor day, so each step clamps off the previous result — a Jan-31
 * rule walks 31, Feb 28, Mar 28, Apr 28… rather than returning to month-end.
 * Correct month-end behaviour needs an anchor day on the model (tracked with
 * the startDate/endDate follow-up). Prefer a day ≤ 28 for new monthly rules.
 */
function addMonthsClamped(current: Date, months: number): Date {
  const anchorDay = current.getDate();
  const next = new Date(current);
  next.setDate(1);
  next.setMonth(next.getMonth() + months);
  // Day 0 of the following month == last day of the target month.
  const daysInTarget = new Date(
    next.getFullYear(),
    next.getMonth() + 1,
    0,
  ).getDate();
  next.setDate(Math.min(anchorDay, daysInTarget));
  return next;
}

export function advanceNextDate(
  current: Date,
  frequency: RecurringFrequency,
): Date {
  switch (frequency) {
    case "Weekly": {
      const next = new Date(current);
      next.setDate(next.getDate() + 7);
      return next;
    }
    case "Monthly":
      return addMonthsClamped(current, 1);
    case "Quarterly":
      return addMonthsClamped(current, 3);
    case "Yearly":
      // Feb 29 in a leap year clamps to Feb 28 the following year.
      return addMonthsClamped(current, 12);
  }
}

interface PostOneResult {
  recurringTransactionId: string;
  posted: boolean;
  artifactKind?: "Bill" | "JournalEntry";
  /** One id per artifact — a multi-property rule posts several. */
  artifactIds?: string[];
  /** The rule's nextDate this result posted (or tried to post) against. */
  periodDate?: string;
  note?: string;
}

type AmountLine = IRecurringTransaction["amounts"][number];

/** Catch-up default when a caller supplies `throughDate` but no explicit cap. */
const DEFAULT_CATCHUP_PERIODS = 24;
/** Absolute ceiling on periods per rule per run, whatever the caller asks. */
const MAX_PERIODS_HARD_CAP = 60;
/** Circuit breaker across the whole run, so N rules × M periods can't run away. */
const DEFAULT_MAX_TOTAL = 500;

export interface PosterOptions {
  /**
   * Post every period whose date falls on or before this day, instead of the
   * single period the cron would post today. Absent = cron semantics.
   */
  throughDate?: Date;
  /** Periods per rule. Defaults to 1 without throughDate, 24 with. */
  maxPeriodsPerRule?: number;
  /** Total postings across the whole run. Default 500. */
  maxTotalPosts?: number;
  /** Restrict the sweep to these rules. */
  ruleIds?: string[];
  /**
   * Run the locked-period gate as this human rather than the role-less system
   * context. Required for a FinancialAdministrator to backfill a closed month.
   */
  actorCtx?: PmContext;
}

function endOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(23, 59, 59, 999);
  return out;
}

/**
 * Is this period due?
 *
 * Two deliberately different tests:
 *  - Cron: fire once `nextDate - postNDaysInAdvance` has arrived, so a bill
 *    dated the 1st is cut a few days early.
 *  - Catch-up: `nextDate <= throughDate`, with NO lead-time subtraction. Using
 *    the trigger test here would post one period PAST the requested bound —
 *    ask for "through July 31" with the default 5-day lead and you would also
 *    get August.
 */
function isDue(
  nextDate: Date,
  postNDaysInAdvance: number,
  today: Date,
  throughDate: Date | null,
): boolean {
  if (throughDate) return new Date(nextDate) <= throughDate;
  const trigger = new Date(nextDate);
  trigger.setDate(trigger.getDate() - postNDaysInAdvance);
  trigger.setHours(0, 0, 0, 0);
  return today >= trigger;
}

/**
 * The dates a rule would post, given its current cursor.
 *
 * The apply loop and the dry-run preview MUST both express "which periods" in
 * terms of this helper — otherwise the preview can promise something the run
 * does not deliver.
 */
export function enumeratePeriods(input: {
  nextDate: Date | null | undefined;
  frequency: RecurringFrequency;
  lastPostedDate?: Date | null;
  postNDaysInAdvance: number;
  today: Date;
  throughDate: Date | null;
  cap: number;
}): Date[] {
  const out: Date[] = [];
  if (!input.nextDate) return out;
  let cursor = new Date(input.nextDate);
  const lastPosted = input.lastPostedDate
    ? new Date(input.lastPostedDate)
    : null;
  if (lastPosted && lastPosted >= cursor) return out;

  while (out.length < input.cap) {
    if (
      !isDue(cursor, input.postNDaysInAdvance, input.today, input.throughDate)
    ) {
      break;
    }
    out.push(new Date(cursor));
    const next = advanceNextDate(cursor, input.frequency);
    if (next <= cursor) break; // monotonicity guard, mirrors the apply loop
    cursor = next;
  }
  return out;
}

/**
 * Assert the locked-period gate against every distinct scope a rule touches.
 * Returns a human-readable note for the FIRST blocked scope, or null when all
 * scopes are writable.
 *
 * Company-scoped rows (and a rule with no rows at all) still contribute a
 * `null` scope, because Global and Per-bank-account policies match regardless
 * of property.
 */
async function firstLockedScope(
  orgId: string,
  txnDate: Date,
  amounts: AmountLine[],
  ctx: PmContext,
): Promise<string | null> {
  const groups = groupAmountsByScope(amounts);
  const scopes: Array<Types.ObjectId | null> =
    groups.length > 0 ? groups.map((g) => g.scopePropertyId) : [null];
  for (const scope of scopes) {
    try {
      await assertWriteAllowed({
        orgId,
        txnDate: new Date(txnDate),
        scopePropertyId: scope ? String(scope) : null,
        ctx,
      });
    } catch (err) {
      if (err instanceof LockedPeriodError) {
        return scope
          ? `Locked period (property ${String(scope)}): ${err.policyMessage}`
          : `Locked period: ${err.policyMessage}`;
      }
      throw err;
    }
  }
  return null;
}

/**
 * Attribute a generated artifact. A catch-up is a deliberate human action, so
 * it is stamped with the person who triggered it; the cron keeps attributing
 * to the rule's author.
 */
function resolveActorUserId(
  opts: PosterOptions,
  rule: IRecurringTransaction,
  orgObjectId: Types.ObjectId,
): string {
  if (opts.actorCtx?.userId) return opts.actorCtx.userId;
  return String(rule.createdByUserId ?? orgObjectId);
}

/** Mongo duplicate-key (E11000) — the unique index rejecting a re-post. */
function isDuplicateKeyError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: number }).code === 11000
  );
}

/**
 * Group a rule's amount lines by the scope they post to.
 *
 * A row counts as Property-scoped only when it names a real property; anything
 * else falls to Company. This one predicate drives bill splitting, the JE's
 * balancing legs, the locked-period gate and the list's scope label, so those
 * four can never disagree about where a rule posts.
 */
export function groupAmountsByScope(
  amounts: AmountLine[],
): Array<{ scopePropertyId: Types.ObjectId | null; lines: AmountLine[] }> {
  const groups = new Map<
    string,
    { scopePropertyId: Types.ObjectId | null; lines: AmountLine[] }
  >();
  for (const line of amounts) {
    const isProperty = line.scopeType === "Property" && line.scopeId;
    const key = isProperty ? String(line.scopeId) : "company";
    let group = groups.get(key);
    if (!group) {
      group = {
        scopePropertyId: isProperty
          ? (line.scopeId as Types.ObjectId)
          : null,
        lines: [],
      };
      groups.set(key, group);
    }
    group.lines.push(line);
  }
  return Array.from(groups.values());
}

async function postArtifact(
  rule: IRecurringTransaction,
  ctx: PmContext,
  periodDate: Date,
): Promise<{ kind: "Bill" | "JournalEntry"; ids: Types.ObjectId[] } | null> {
  const groups = groupAmountsByScope(rule.amounts ?? []);
  if (groups.length === 0) return null;

  if (rule.type === "Bill" || rule.type === "Check") {
    // A Bill's `scope` is a single {type,id} and postBillToLedger stamps that
    // one scope onto every JE line — a bill physically cannot represent two
    // properties. So a rule split across properties posts one bill per
    // property, which is also what makes each property's share land in its own
    // Financials column.
    const created: Types.ObjectId[] = [];
    for (const group of groups) {
      // Each group carries its own unique key (rule, period, scope), so a
      // duplicate here means only THIS scope was already posted — skip it and
      // keep going. Aborting the whole period would discard groups that
      // legitimately posted.
      let bill;
      try {
        bill = await Bill.create({
          organizationId: rule.organizationId,
          vendorId: rule.payee?.type === "Vendor" ? rule.payee.id : null,
          invoiceDate: periodDate,
          status: "Due",
          memo: rule.memo,
          lines: group.lines.map((a) => ({
            accountId: a.accountId,
            description: a.description,
            amount: a.amount,
          })),
          scope: group.scopePropertyId
            ? { type: "Property", id: group.scopePropertyId }
            : { type: "Company", id: null },
          createdBy:
            rule.type === "Check" ? "Recurring check" : "Recurring bill",
          createdByUserId: rule.createdByUserId,
          recurringTransactionId: rule._id,
          recurringPeriodDate: periodDate,
        });
      } catch (err) {
        if (isDuplicateKeyError(err)) continue;
        // Roll back this period's earlier groups: no transactions in this
        // codebase, so compensate by hand. Leaving them would double up when
        // the released claim retries.
        if (created.length > 0) {
          await Bill.deleteMany({ _id: { $in: created } });
        }
        throw err;
      }

      try {
        // Record the accrual JE so the bill reaches Financials. This also
        // re-asserts the locked period against THIS bill's own scope.
        const { journalEntryId } = await postBillToLedger({
          orgId: String(rule.organizationId),
          ctx,
          bill: {
            _id: bill._id,
            invoiceDate: bill.invoiceDate,
            memo: bill.memo,
            vendorId: bill.vendorId,
            scopePropertyId: group.scopePropertyId,
            lines: bill.lines,
            attachmentFileId: bill.attachmentFileId,
          },
        });
        bill.journalEntryId = journalEntryId;
        await bill.save();
        created.push(bill._id);
      } catch (err) {
        // A bill must never survive as posted-but-unledgered. Drop this one
        // plus every earlier group in the period, then let the caller release
        // the claim so the rule retries cleanly.
        await Bill.deleteMany({ _id: { $in: [...created, bill._id] } });
        throw err;
      }
    }
    return { kind: "Bill", ids: created };
  }

  if (rule.type === "Journal entry") {
    // Each amount row is a DEBIT carrying its own scope — the same reading the
    // Bill path gives the identical grid, so one grid means one thing
    // everywhere. The offset is one CREDIT per distinct scope, each summing
    // that scope's debits and carrying that scope, so per-property Financials
    // nets correctly on BOTH legs.
    //
    // This replaces an "Auto-balance placeholder" debit to the first row's own
    // account, which was accounting nonsense and, being Draft, never reached
    // Financials to expose itself.
    const cashAccountId = await resolveBankCashAccountId(
      rule.organizationId as Types.ObjectId,
      (rule.bankAccountId as Types.ObjectId | null) ?? null,
    );
    if (!cashAccountId) {
      // Unresolvable offset — return null so the caller releases the claim and
      // the rule retries once an Operating Cash account is configured.
      return null;
    }

    const debits = rule.amounts.map((a) => ({
      accountId: a.accountId,
      scopeType: a.scopeType === "Property" && a.scopeId ? "Property" : "Company",
      scopeId: a.scopeType === "Property" && a.scopeId ? a.scopeId : null,
      unitId: a.unitId ?? null,
      description: a.description,
      debit: a.amount,
      credit: 0,
    }));
    const credits = groups.map((group) => ({
      accountId: cashAccountId,
      scopeType: group.scopePropertyId ? "Property" : "Company",
      scopeId: group.scopePropertyId,
      unitId: null,
      description: rule.memo ?? "Recurring journal entry",
      debit: 0,
      credit: group.lines.reduce((s, a) => s + a.amount, 0),
    }));
    if (credits.every((c) => c.credit === 0)) return null;

    // Header scope is advisory (reports read line scope) but drives the GL
    // index, so name the property when the whole entry sits on exactly one.
    const singleProperty =
      groups.length === 1 && groups[0]!.scopePropertyId
        ? groups[0]!.scopePropertyId
        : null;

    // The Bill path gets its lock check inside postBillToLedger; this branch
    // has none of its own, so assert here too — across EVERY scope the entry
    // touches, not just the header's. Belt-and-braces against a race with the
    // caller's pre-claim gate.
    const lockNote = await firstLockedScope(
      String(rule.organizationId),
      periodDate,
      rule.amounts ?? [],
      ctx,
    );
    if (lockNote) throw new Error(lockNote);

    const je = await JournalEntry.create({
      organizationId: rule.organizationId,
      date: periodDate,
      scopeType: singleProperty ? "Property" : "Company",
      scopeId: singleProperty,
      memo: rule.memo ?? "Recurring journal entry",
      lines: [...debits, ...credits],
      // Was "Draft" — every report hard-filters status:'Posted', so recurring
      // JEs never reached Financials at all.
      status: "Posted",
      postedAt: periodDate,
      createdByUserId: rule.createdByUserId,
      recurringTransactionId: rule._id,
      recurringPeriodDate: periodDate,
    });
    return { kind: "JournalEntry", ids: [je._id] };
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
  opts: PosterOptions = {},
): Promise<PostOneResult[]> {
  await connectToDatabase();
  if (!Types.ObjectId.isValid(orgId)) {
    throw new Error("runRecurringPoster requires a valid orgId.");
  }
  const orgObjectId = new Types.ObjectId(orgId);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  const throughDate = opts.throughDate ? endOfDay(opts.throughDate) : null;
  // One period per run is the cron's contract; a catch-up caller opts into
  // more. Clamped regardless of what the caller asks for.
  const maxPeriodsPerRule = Math.min(
    MAX_PERIODS_HARD_CAP,
    Math.max(
      1,
      opts.maxPeriodsPerRule ?? (throughDate ? DEFAULT_CATCHUP_PERIODS : 1),
    ),
  );
  const maxTotalPosts = Math.max(1, opts.maxTotalPosts ?? DEFAULT_MAX_TOTAL);

  // Locked-period context. A cron has no human roles, so it can NEVER override
  // a lock — locked periods must hold against automated posting. A catch-up
  // invoked by a human passes `actorCtx` so their real roles apply, which is
  // how a FinancialAdministrator backfills a closed month. Note
  // `assertWriteAllowed` short-circuits on role before querying policies, so
  // that override covers Global, Per-property and Per-bank-account alike.
  const systemCtx: PmContext = {
    userId: String(orgObjectId),
    orgId,
    roles: [],
    impersonatedBy: null,
  };
  const ctx = opts.actorCtx ?? systemCtx;

  const filter: Record<string, unknown> = {
    active: true,
    organizationId: orgObjectId,
  };
  if (opts.ruleIds?.length) {
    filter._id = {
      $in: opts.ruleIds
        .filter((id) => Types.ObjectId.isValid(id))
        .map((id) => new Types.ObjectId(id)),
    };
  }
  const candidates = await RecurringTransaction.find(filter);

  const results: PostOneResult[] = [];
  let totalPosts = 0;

  for (const candidate of candidates) {
    let periodsPosted = 0;

    // Inner loop walks ONE rule forward through consecutive periods.
    //
    // Every path that does NOT advance the cursor must `break`, never
    // `continue` — the locked-period skip above all, which leaves `nextDate`
    // untouched by design and would otherwise spin forever. The single
    // `continue` below is the duplicate-key case, where the claim has already
    // advanced the cursor, so the loop is guaranteed to make progress.
    while (periodsPosted < maxPeriodsPerRule && totalPosts < maxTotalPosts) {
      // Re-read each iteration. The claim below pins (nextDate, lastPostedDate)
      // and `willEnd` reads postedCount — stale values would make the second
      // claim match nothing, or overshoot an "End after N" rule's limit.
      const rule = await RecurringTransaction.findOne({
        _id: candidate._id,
        organizationId: orgObjectId,
      });
      if (!rule || !rule.active || !rule.nextDate) break;

      const periodDate = new Date(rule.nextDate);
      const lastPosted = rule.lastPostedDate
        ? new Date(rule.lastPostedDate)
        : null;
      if (lastPosted && lastPosted >= rule.nextDate) {
        if (periodsPosted === 0) {
          results.push({
            recurringTransactionId: String(rule._id),
            posted: false,
            note: "Already posted",
          });
        }
        break;
      }

      if (!isDue(rule.nextDate, rule.postNDaysInAdvance, today, throughDate)) {
        if (periodsPosted === 0) {
          results.push({
            recurringTransactionId: String(rule._id),
            posted: false,
            note: throughDate ? "Nothing due through that date" : "Not yet due",
          });
        }
        break;
      }

      // Locked-period gate. Check EVERY distinct scope the rule touches, not
      // just the first row's: a partial post would advance the claim and
      // permanently lose the locked property's share of this period. So it is
      // all-or-nothing.
      const lockError = await firstLockedScope(
        orgId,
        periodDate,
        rule.amounts ?? [],
        ctx,
      );
      if (lockError) {
        results.push({
          recurringTransactionId: String(rule._id),
          posted: false,
          periodDate: periodDate.toISOString(),
          note: lockError,
        });
        break;
      }

      // Atomically CLAIM this nextDate before posting so concurrent runs can't
      // double-post. The filter pins the rule's current state; only one racer
      // matches and advances it.
      const claimedNextDate = advanceNextDate(rule.nextDate, rule.frequency);
      if (claimedNextDate <= periodDate) {
        // Cursor monotonicity guard — without this a frequency the advancer
        // failed to move would loop until the caps trip.
        results.push({
          recurringTransactionId: String(rule._id),
          posted: false,
          periodDate: periodDate.toISOString(),
          note: "Next date did not advance; check the rule's frequency",
        });
        break;
      }
      const willEnd =
        rule.duration === "End after N" &&
        typeof rule.occurrenceCount === "number" &&
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
          periodDate: periodDate.toISOString(),
          note: "Already claimed by a concurrent run",
        });
        break;
      }

      const releaseClaim = async () => {
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
      };

      try {
        // Post using the CLAIMED state (the pre-update snapshot in `claim`
        // still carries the nextDate we are posting against).
        const artifact = await postArtifact(
          claim,
          { ...ctx, userId: resolveActorUserId(opts, claim, orgObjectId) },
          periodDate,
        );
        if (!artifact) {
          // Unsupported type / missing accounts — release the claim so a later
          // run can retry once the rule is fixed.
          await releaseClaim();
          results.push({
            recurringTransactionId: String(rule._id),
            posted: false,
            periodDate: periodDate.toISOString(),
            note: "Skipped (unsupported type or missing accounts)",
          });
          break;
        }

        results.push({
          recurringTransactionId: String(rule._id),
          posted: true,
          artifactKind: artifact.kind,
          artifactIds: artifact.ids.map(String),
          periodDate: periodDate.toISOString(),
        });
        periodsPosted += 1;
        totalPosts += 1;
      } catch (err) {
        if (isDuplicateKeyError(err)) {
          // The unique index caught a period that is genuinely already
          // posted — e.g. a concurrent run that beat us between the claim and
          // the insert. Let the claim STAND (rolling back would re-offer an
          // already-posted period forever) and move on to the next period.
          results.push({
            recurringTransactionId: String(rule._id),
            posted: false,
            periodDate: periodDate.toISOString(),
            note: "Duplicate suppressed (period already posted)",
          });
          periodsPosted += 1;
          continue;
        }
        // Posting failed after the claim — roll the claim back so the rule
        // re-fires on the next run rather than silently skipping a period.
        await releaseClaim();
        results.push({
          recurringTransactionId: String(rule._id),
          posted: false,
          periodDate: periodDate.toISOString(),
          note: err instanceof Error ? err.message : "Posting failed",
        });
        break;
      }
    }

    if (totalPosts >= maxTotalPosts) {
      results.push({
        recurringTransactionId: String(candidate._id),
        posted: false,
        note: `Run capped at ${maxTotalPosts} postings; re-run to continue`,
      });
      break;
    }
  }
  return results;
}

/** Readability alias for the catch-up call shape. */
export function runRecurringPosterUntil(
  orgId: string,
  throughDate: Date,
  opts: Omit<PosterOptions, "throughDate"> = {},
): Promise<PostOneResult[]> {
  return runRecurringPoster(orgId, new Date(), { ...opts, throughDate });
}

export interface PlannedPeriod {
  ruleId: string;
  memo: string;
  type: string;
  frequency: string;
  /** ISO date of the period this row would post. */
  periodDate: string;
  /** Total for the period, in cents, across all scopes. */
  amountCents: number;
  /** One entry per artifact this period would generate. */
  scopes: Array<{
    propertyId: string | null;
    propertyName: string;
    amountCents: number;
  }>;
  status: "will-post" | "locked" | "unsupported" | "possible-duplicate";
  note?: string;
  /** Rule-level warnings (e.g. RECURRING_MISSING_PAYEE) worth showing. */
  warnings: string[];
}

export interface CatchUpPlan {
  throughDate: string;
  plan: PlannedPeriod[];
  totals: {
    rules: number;
    periods: number;
    cents: number;
    blocked: number;
  };
}

/**
 * Enumerate what a catch-up WOULD post, writing nothing.
 *
 * Deliberately a separate pure enumeration rather than "run the loop with the
 * writes skipped": without the atomic claim the cursor never advances, so a
 * write-skipping loop would spin on the first period forever. Both paths share
 * `enumeratePeriods` and `groupAmountsByScope`, which is what keeps the preview
 * honest.
 */
export async function planRecurringCatchUp(
  orgId: string,
  throughDateInput: Date,
  opts: { ruleIds?: string[]; maxPeriodsPerRule?: number; now?: Date } = {},
): Promise<CatchUpPlan> {
  await connectToDatabase();
  if (!Types.ObjectId.isValid(orgId)) {
    throw new Error("planRecurringCatchUp requires a valid orgId.");
  }
  const orgObjectId = new Types.ObjectId(orgId);
  const today = new Date(opts.now ?? new Date());
  today.setHours(0, 0, 0, 0);
  const throughDate = endOfDay(throughDateInput);
  const cap = Math.min(
    MAX_PERIODS_HARD_CAP,
    Math.max(1, opts.maxPeriodsPerRule ?? DEFAULT_CATCHUP_PERIODS),
  );

  // Preview is read-only, so it runs as the system context: it reports what a
  // lock WOULD block without needing (or granting) override.
  const previewCtx: PmContext = {
    userId: String(orgObjectId),
    orgId,
    roles: [],
    impersonatedBy: null,
  };

  const filter: Record<string, unknown> = {
    active: true,
    organizationId: orgObjectId,
  };
  if (opts.ruleIds?.length) {
    filter._id = {
      $in: opts.ruleIds
        .filter((id) => Types.ObjectId.isValid(id))
        .map((id) => new Types.ObjectId(id)),
    };
  }
  const rules = await RecurringTransaction.find(filter).sort({ nextDate: 1 });

  // Resolve every referenced property name up front, one query for the run.
  const propertyIds = Array.from(
    new Set(
      rules.flatMap((r) =>
        groupAmountsByScope(r.amounts ?? [])
          .map((g) => g.scopePropertyId)
          .filter((id): id is Types.ObjectId => Boolean(id))
          .map(String),
      ),
    ),
  );
  const propertyNames = new Map<string, string>();
  if (propertyIds.length > 0) {
    const props = await Property.find({
      _id: { $in: propertyIds.map((id) => new Types.ObjectId(id)) },
      organizationId: orgObjectId,
    })
      .select({ propertyName: 1 })
      .lean<{ _id: Types.ObjectId; propertyName: string }[]>();
    for (const p of props) propertyNames.set(String(p._id), p.propertyName);
  }

  const plan: PlannedPeriod[] = [];
  const rulesWithWork = new Set<string>();

  for (const rule of rules) {
    let periods = enumeratePeriods({
      nextDate: rule.nextDate,
      frequency: rule.frequency,
      lastPostedDate: rule.lastPostedDate,
      postNDaysInAdvance: rule.postNDaysInAdvance,
      today,
      throughDate,
      cap,
    });
    if (periods.length === 0) continue;

    // "End after N" truncates the series — show the rule closing rather than
    // promising periods the claim would refuse.
    if (
      rule.duration === "End after N" &&
      typeof rule.occurrenceCount === "number"
    ) {
      const remaining = Math.max(
        0,
        rule.occurrenceCount - (rule.postedCount ?? 0),
      );
      periods = periods.slice(0, remaining);
      if (periods.length === 0) continue;
    }

    const groups = groupAmountsByScope(rule.amounts ?? []);
    const scopes = groups.map((g) => ({
      propertyId: g.scopePropertyId ? String(g.scopePropertyId) : null,
      propertyName: g.scopePropertyId
        ? (propertyNames.get(String(g.scopePropertyId)) ?? "Unknown property")
        : "Company",
      amountCents: g.lines.reduce((s, a) => s + a.amount, 0),
    }));
    const amountCents = scopes.reduce((s, g) => s + g.amountCents, 0);
    const warnings = (rule.warnings ?? []).map((w) =>
      typeof w === "string" ? w : (w as { code?: string }).code ?? "Warning",
    );

    rulesWithWork.add(String(rule._id));

    for (const periodDate of periods) {
      const row: PlannedPeriod = {
        ruleId: String(rule._id),
        memo: rule.memo ?? "",
        type: rule.type,
        frequency: rule.frequency,
        periodDate: periodDate.toISOString(),
        amountCents,
        scopes,
        status: "will-post",
        warnings,
      };

      if (groups.length === 0) {
        row.status = "unsupported";
        row.note = "Rule has no amount lines";
        plan.push(row);
        continue;
      }

      const lockNote = await firstLockedScope(
        orgId,
        periodDate,
        rule.amounts ?? [],
        previewCtx,
      );
      if (lockNote) {
        row.status = "locked";
        row.note = lockNote;
        plan.push(row);
        continue;
      }

      const dup = await findPossibleDuplicate(orgObjectId, rule, periodDate);
      if (dup) {
        row.status = "possible-duplicate";
        row.note = dup;
      }
      plan.push(row);
    }
  }

  return {
    throughDate: throughDate.toISOString(),
    plan,
    totals: {
      rules: rulesWithWork.size,
      periods: plan.length,
      cents: plan
        .filter((p) => p.status !== "locked" && p.status !== "unsupported")
        .reduce((s, p) => s + p.amountCents, 0),
      blocked: plan.filter(
        (p) => p.status === "locked" || p.status === "unsupported",
      ).length,
    },
  };
}

/**
 * Advisory scan for an artifact that already covers this period but was NOT
 * created by this rule — i.e. someone keyed it in by hand. The unique index
 * cannot see those, and a manually-entered bill colliding with a backfilled
 * period is exactly the shape of the earlier rent double-post incident.
 *
 * Deliberately advisory: it matches on vendor + total inside the period's
 * month, which is a heuristic, so it warns rather than blocks.
 */
async function findPossibleDuplicate(
  orgObjectId: Types.ObjectId,
  rule: IRecurringTransaction,
  periodDate: Date,
): Promise<string | null> {
  const total = (rule.amounts ?? []).reduce((s, a) => s + a.amount, 0);
  if (total === 0) return null;
  const monthStart = new Date(
    periodDate.getFullYear(),
    periodDate.getMonth(),
    1,
  );
  const monthEnd = endOfDay(
    new Date(periodDate.getFullYear(), periodDate.getMonth() + 1, 0),
  );

  if (rule.type === "Bill" || rule.type === "Check") {
    const existing = await Bill.findOne({
      organizationId: orgObjectId,
      vendorId: rule.payee?.type === "Vendor" ? rule.payee.id : null,
      invoiceDate: { $gte: monthStart, $lte: monthEnd },
      status: { $ne: "Voided" },
      // Only flag rows this rule did not create — its own postings are already
      // guarded by the unique index and would be noise here.
      recurringTransactionId: { $ne: rule._id },
    })
      .select({ _id: 1, lines: 1 })
      .lean<{ _id: Types.ObjectId; lines: { amount: number }[] } | null>();
    if (!existing) return null;
    const existingTotal = (existing.lines ?? []).reduce(
      (s, l) => s + (l.amount ?? 0),
      0,
    );
    if (existingTotal !== total) return null;
    return `A bill for the same vendor and amount already exists in ${monthStart.toLocaleDateString("en-US", { month: "long", year: "numeric" })} (${String(existing._id)})`;
  }
  return null;
}
