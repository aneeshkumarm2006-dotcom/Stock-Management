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
// SCOPE. A rule's amount lines each carry their own Property/Company scope,
// and a Company scope may name a specific CompanyAccount. Since a Bill's scope
// is a single {type,id}, a rule spanning several scopes posts one Bill per
// scope (`groupByScope` from lib/pm/scope.ts). Recurring JEs balance per scope
// for the same reason. This all used to read `amounts[0]` only, which silently
// dumped a whole multi-property rule onto the first row's property.
//
// ALLOCATION. A company-scoped line may be split across that company's
// properties (`expandRuleAmounts`). The expansion produces extra *lines inside
// the same scope group* — never extra groups. That is deliberate and
// load-bearing:
//   - the bill count per period is unchanged, so the unique partial index on
//     (org, recurringTransactionId, recurringPeriodDate, scope.id) cannot
//     collide and no share can be lost to a swallowed duplicate-key error;
//   - the JE count per period is unchanged, so the JournalEntry unique index —
//     which has NO scope component — stays safe;
//   - the payable stays whole: one invoice, one vendor, one debt, with the AP
//     credit on the company that owes it, while each debit lands on the
//     building carrying that share.
// If you ever change this to post one artifact per allocated property, the
// JournalEntry index must gain a scope component FIRST.
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
import { assertWriteAllowed, LockedPeriodError } from "@/lib/pm/lockedPeriod";
import { postBillToLedger } from "@/lib/pm/postBillToLedger";
import { resolveBankCashAccountId } from "@/lib/pm/postBillPaymentToLedger";
import {
  groupByScope,
  isNamedCompanyScope,
  isPropertyScope,
  normalizeScope,
  scopeKey,
  toBillScope,
  toJournalLineScope,
  type PmScope,
} from "@/lib/pm/scope";
import { resolveScopeLabels } from "@/lib/pm/scopeQuery";
import { logActivity } from "@/lib/pm/activity";
import { allocateCents } from "@/lib/pm/allocation";
import {
  createCompanyPropertyResolver,
  membersToWeights,
} from "@/lib/pm/companyProperties";
import {
  amortizationAt,
  paymentIndexFor,
  periodsPerYearFor,
  type AmortizationPeriod,
} from "@/lib/pm/amortization";
import { fromCents } from "@/lib/pm/currency";
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
  /**
   * Scopes whose artifact was rejected as an already-posted duplicate. Empty
   * on a clean run. Reported rather than swallowed so a scope whose money
   * never posted can't look like a success.
   */
  skippedScopes?: SkippedScope[];
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
 *
 * Takes EXPANDED lines, so an allocated share is checked against the property
 * it actually lands on. That is stricter than before — a company-level
 * insurance line used to slip past a Per-property lock because it carried no
 * property id — and it is correct: the poster is all-or-nothing by design, so
 * a rule that would write into a locked property now stalls instead of
 * posting a partial period and advancing the cursor past it.
 */
async function firstLockedScope(
  orgId: string,
  txnDate: Date,
  lines: PostingLine[],
  ctx: PmContext,
): Promise<string | null> {
  const seen = new Map<string, PmScope>();
  for (const line of lines) {
    for (const scope of [line.groupScope, line.lineScope]) {
      seen.set(scopeKey(scope), scope);
    }
  }
  const scopes: PmScope[] =
    seen.size > 0
      ? Array.from(seen.values())
      : [{ type: "Company", id: null }];

  for (const scope of scopes) {
    const propertyId = isPropertyScope(scope) ? String(scope.id) : null;
    try {
      await assertWriteAllowed({
        orgId,
        txnDate: new Date(txnDate),
        scopePropertyId: propertyId,
        ctx,
      });
    } catch (err) {
      if (err instanceof LockedPeriodError) {
        return propertyId
          ? `Locked period (property ${propertyId}): ${err.policyMessage}`
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
 * One posting line, after any allocation has been expanded.
 *
 * `groupScope` is the scope the artifact (Bill / JE credit leg) is grouped and
 * created under — always the ORIGINAL amount-line scope. `lineScope` is where
 * this particular debit lands, which for an allocated share is a property
 * inside that company. Keeping the two separate is what lets one payable carry
 * per-property expense.
 */
export interface PostingLine {
  groupScope: PmScope;
  lineScope: PmScope;
  accountId: Types.ObjectId;
  unitId: Types.ObjectId | null;
  description?: string;
  refNo?: string;
  /** Integer cents. */
  amount: number;
  /** Set when this line came from splitting a company-level amount. */
  allocatedFromCompanyId?: string;
}

export interface ExpandedRuleAmounts {
  lines: PostingLine[];
  /** Human-readable notes for the dry-run preview and the run result. */
  notes: string[];
  /**
   * Blocking problems — bad loan terms, a period past the end of a mortgage.
   *
   * A CHANNEL rather than a thrown error, deliberately. `expandRuleAmounts` is
   * called before the period claim and outside the try/catch that wraps
   * `postArtifact`, so a throw here would escape the per-rule loop and abort the
   * whole nightly cron for every remaining rule. The poster treats a non-empty
   * `errors` exactly as it treats `lockError`: record it, stop this rule, and
   * leave the cursor untouched so it retries once the data is fixed.
   */
  errors: string[];
  /** Per-period mortgage split, when this expansion produced one. */
  mortgage?: {
    index: number;
    interestCents: number;
    principalCents: number;
    closingBalanceCents: number;
    note?: string;
  };
}

function amountLineScope(line: AmountLine): PmScope {
  return normalizeScope({ scopeType: line.scopeType, scopeId: line.scopeId });
}

/**
 * Expand a rule's amount lines, splitting any allocated company line across
 * that company's eligible properties.
 *
 * Every caller that needs to know what a rule will post MUST go through here —
 * the pre-claim lock gate, the artifact writer and the catch-up preview — or
 * the preview would show something different from what posts.
 *
 * Money is never dropped. If a company has no eligible properties (none
 * assigned, or all of them book in a different currency) the line posts whole
 * at company scope, exactly as it does today, and the reason is recorded.
 *
 * MORTGAGE SPLIT. A line flagged `splitAsMortgage` becomes TWO posting lines in
 * the SAME scope group — interest and principal — differing only in account and
 * amount. That is what keeps the artifact count per period unchanged, so
 * neither the Bill nor the JournalEntry unique index can start colliding. It is
 * also why the split works on all three rule types: both legs are DEBITS, so
 * the Bill path (which turns every line into a debit and credits AP) produces
 * correct accrual accounting with no change of its own.
 *
 * `periodDate` is required to compute the split — the payment number is derived
 * from the date versus the loan's origination anchor, never from a position in
 * a run. That is what makes a catch-up backfill reproduce exactly what the cron
 * would have posted.
 */
export async function expandRuleAmounts(input: {
  rule: Pick<IRecurringTransaction, "amounts" | "mortgage" | "frequency">;
  resolve: ReturnType<typeof createCompanyPropertyResolver>;
  /** The period being posted. Required for a mortgage rule. */
  periodDate?: Date;
}): Promise<ExpandedRuleAmounts> {
  const out: PostingLine[] = [];
  const notes: string[] = [];
  const errors: string[] = [];
  let mortgageSplit: ExpandedRuleAmounts["mortgage"];

  for (const line of input.rule.amounts ?? []) {
    const scope = amountLineScope(line);
    const base: Omit<PostingLine, "lineScope"> = {
      groupScope: scope,
      accountId: line.accountId,
      unitId: (line.unitId as Types.ObjectId | null) ?? null,
      description: line.description,
      refNo: line.refNo,
      amount: line.amount ?? 0,
    };

    // Mortgage split first. It and CompanyProperties allocation are mutually
    // exclusive (rejected in validation), so the order is for clarity only.
    if (line.splitAsMortgage) {
      const split = splitMortgageLine({
        line,
        base,
        scope,
        mortgage: input.rule.mortgage,
        frequency: input.rule.frequency,
        periodDate: input.periodDate,
      });
      if (split.error) {
        errors.push(split.error);
        continue;
      }
      out.push(...split.lines);
      if (split.note) notes.push(split.note);
      mortgageSplit = split.summary;
      continue;
    }

    const wantsSplit =
      line.allocation?.mode === "CompanyProperties" &&
      isNamedCompanyScope(scope);

    if (!wantsSplit) {
      out.push({ ...base, lineScope: scope });
      continue;
    }

    const set = await input.resolve(
      String(scope.id),
      line.allocation?.basis ?? "Equal",
      (line.allocation?.weights ?? []).map((w) => ({
        propertyId: String(w.propertyId),
        weight: w.weight,
      })),
    );

    if (!set || !set.allocatable) {
      notes.push(
        set
          ? `"${line.description ?? "line"}" was not split: ${set.companyName} has no eligible ${set.currency} properties. Posted at company level.`
          : `"${line.description ?? "line"}" was not split: the company no longer exists. Posted at company level.`,
      );
      out.push({ ...base, lineScope: scope });
      continue;
    }

    if (set.excluded.length > 0) {
      const names = set.excluded
        .filter((e) => e.reason === "CURRENCY_MISMATCH")
        .map((e) => `${e.propertyName} (${e.currency})`);
      if (names.length > 0) {
        notes.push(
          `${set.companyName} books in ${set.currency}; excluded from the split: ${names.join(", ")}.`,
        );
      }
    }

    const shares = allocateCents(base.amount, membersToWeights(set.members));
    const nameById = new Map(
      set.members.map((m) => [m.propertyId, m.propertyName]),
    );
    for (const share of shares) {
      // A zero share would make an all-zero bill, which Bill.pre('validate')
      // rejects outright. Dropping it costs nothing: allocateCents is
      // exactly-summing, so the remaining shares still total the source.
      if (share.cents === 0) continue;
      out.push({
        ...base,
        lineScope: { type: "Property", id: share.key },
        amount: share.cents,
        description: base.description
          ? `${base.description} — allocated from ${set.companyName}`
          : `Allocated from ${set.companyName} (${nameById.get(share.key) ?? ""})`,
        allocatedFromCompanyId: set.companyAccountId,
      });
    }
  }

  return { lines: out, notes, errors, mortgage: mortgageSplit };
}

/**
 * Turn one mortgage payment line into an interest leg and a principal leg.
 *
 * Both legs are debits and both sit in the SAME scope group — see the note on
 * `expandRuleAmounts`. Every failure is returned as a string rather than thrown,
 * for the reason documented on `ExpandedRuleAmounts.errors`.
 */
function splitMortgageLine(input: {
  line: AmountLine;
  base: Omit<PostingLine, "lineScope">;
  scope: PmScope;
  mortgage: IRecurringTransaction["mortgage"];
  frequency: RecurringFrequency;
  periodDate?: Date;
}): {
  lines: PostingLine[];
  note?: string;
  error?: string;
  summary?: ExpandedRuleAmounts["mortgage"];
} {
  const label = input.line.description || "Mortgage payment";
  const m = input.mortgage;
  if (!m) {
    return {
      lines: [],
      error: `"${label}" is marked as a mortgage payment but the rule has no loan terms.`,
    };
  }
  if (!input.periodDate) {
    return {
      lines: [],
      error: `"${label}" could not be split: no period date was supplied.`,
    };
  }
  if (!m.principalAccountId || !m.interestAccountId) {
    return {
      lines: [],
      error: `"${label}" could not be split: choose both an interest account and a principal (long-term liability) account.`,
    };
  }

  let index: number;
  let row: AmortizationPeriod;
  try {
    const periodsPerYear = periodsPerYearFor(input.frequency);
    index = paymentIndexFor({
      originationDate: new Date(m.originationDate),
      periodDate: input.periodDate,
      frequency: input.frequency,
      paymentsAlreadyMade: m.paymentsAlreadyMade ?? 0,
    });
    row = amortizationAt(
      {
        originalPrincipalCents: m.originalPrincipalCents,
        annualRatePct: m.annualRatePct,
        termPeriods: m.termPeriods,
        periodsPerYear,
        compounding: m.compounding,
        // The stored payment is authoritative — it is what leaves the bank.
        // Only the split is computed.
        paymentCents: input.base.amount,
      },
      index,
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { lines: [], error: `"${label}": ${msg}` };
  }

  let note: string | undefined;
  if (row.isFinal && row.adjustedFromScheduledPayment !== 0) {
    // The last payment clears the balance exactly, so it legitimately differs
    // from the stored amount by a few cents. Surface it rather than quietly
    // posting a different total.
    note =
      `"${label}" is the final payment (#${index}): posting ` +
      `${fromCents(row.paymentCents)} instead of ${fromCents(input.base.amount)} ` +
      `so the loan clears to exactly zero.`;
  }

  const lines: PostingLine[] = [];
  if (row.interestCents > 0) {
    lines.push({
      ...input.base,
      accountId: m.interestAccountId,
      lineScope: input.scope,
      amount: row.interestCents,
      description: `${label} — interest (payment ${index} of ${m.termPeriods})`,
    });
  }
  if (row.principalCents > 0) {
    // A DEBIT to the liability: the payment REDUCES the loan. A credit here
    // would grow it and would still balance, which is exactly why it has to be
    // right by construction rather than caught downstream.
    lines.push({
      ...input.base,
      accountId: m.principalAccountId,
      lineScope: input.scope,
      amount: row.principalCents,
      description: `${label} — principal (payment ${index} of ${m.termPeriods})`,
    });
  }
  if (lines.length === 0) {
    return {
      lines: [],
      error: `"${label}" computed a zero interest and zero principal split at payment ${index}.`,
    };
  }

  return {
    lines,
    note,
    summary: {
      index,
      interestCents: row.interestCents,
      principalCents: row.principalCents,
      closingBalanceCents: row.closingBalanceCents,
      note,
    },
  };
}

/**
 * Merge posting lines that share a scope into one row.
 *
 * Only used by the dry-run preview, and only for a mortgage period: its two
 * legs sit on the same scope by design, so listing them separately would show
 * the same property twice and read as a duplicate. The split itself is surfaced
 * as `PlannedPeriod.mortgage`.
 */
function collapseByScope(lines: PostingLine[]): PostingLine[] {
  const out = new Map<string, PostingLine>();
  for (const l of lines) {
    const key = `${scopeKey(l.lineScope)}|${l.allocatedFromCompanyId ?? ""}`;
    const prev = out.get(key);
    if (prev) prev.amount += l.amount;
    else out.set(key, { ...l });
  }
  return Array.from(out.values());
}

/**
 * Group posting lines by the scope their artifact is created under.
 *
 * A row counts as Property-scoped only when it names a real property; anything
 * else falls to Company, and a Company scope may name a CompanyAccount. This
 * one predicate drives bill splitting, the JE's balancing legs, the
 * locked-period gate and the list's scope label, so those four can never
 * disagree about where a rule posts.
 */
export function groupPostingLines(lines: PostingLine[]) {
  return groupByScope(lines, (l) => ({
    scopeType: l.groupScope.type,
    scopeId: l.groupScope.id,
  }));
}

/**
 * Undo a partially-posted period.
 *
 * The bills alone are not enough. `postBillToLedger` writes a **Posted**
 * JournalEntry before its bill id is recorded, so deleting only the bills left
 * every earlier group's JE orphaned in the ledger — and because the claim is
 * then released and the period re-posts, the expense was counted twice while
 * the run reported "Posting failed", which reads to a human as *nothing
 * happened*. Deleting both keeps the compensation symmetric.
 *
 * Hard delete is right here and reversal is not: these rows are seconds old,
 * nothing has read them, and a reversing pair for a JE nobody saw would just
 * pollute the ledger. The activity entry makes the compensation visible.
 */
async function rollbackPeriod(
  billIds: Types.ObjectId[],
  journalEntryIds: Types.ObjectId[],
  rule: IRecurringTransaction,
  periodDate: Date,
): Promise<void> {
  if (billIds.length === 0 && journalEntryIds.length === 0) return;
  if (billIds.length > 0) {
    await Bill.deleteMany({
      _id: { $in: billIds },
      organizationId: rule.organizationId,
    });
  }
  if (journalEntryIds.length > 0) {
    await JournalEntry.deleteMany({
      _id: { $in: journalEntryIds },
      organizationId: rule.organizationId,
    });
  }
  try {
    await logActivity({
      orgId: String(rule.organizationId),
      parentType: "RecurringTransaction",
      parentId: rule._id,
      eventType: "Recurring poster — partial period rolled back",
      actorUserId: null,
      payload: {
        periodDate: periodDate.toISOString(),
        deletedBillIds: billIds.map(String),
        deletedJournalEntryIds: journalEntryIds.map(String),
      },
    });
  } catch {
    // Never let audit logging mask the original posting failure.
  }
}

export interface SkippedScope {
  scopeKey: string;
  cents: number;
  reason: string;
}

export interface PostArtifactResult {
  kind: "Bill" | "JournalEntry";
  ids: Types.ObjectId[];
  /** Scopes a duplicate-key rejected. Surfaced, never swallowed. */
  skippedScopes: SkippedScope[];
  notes: string[];
}

async function postArtifact(
  rule: IRecurringTransaction,
  ctx: PmContext,
  periodDate: Date,
  expanded: ExpandedRuleAmounts,
): Promise<PostArtifactResult | null> {
  const groups = groupPostingLines(expanded.lines);
  if (groups.length === 0) return null;
  const skippedScopes: SkippedScope[] = [];

  if (rule.type === "Bill" || rule.type === "Check") {
    // A Bill's `scope` is a single {type,id}, so a rule spanning several scopes
    // posts one bill per scope — that is what makes each scope's share land in
    // its own Financials column. An ALLOCATED line does not add a group: it
    // stays inside its company's bill and only its per-line scope differs, so
    // the vendor still gets exactly one payable.
    const created: Types.ObjectId[] = [];
    const createdJeIds: Types.ObjectId[] = [];
    for (const group of groups) {
      let bill;
      try {
        bill = await Bill.create({
          organizationId: rule.organizationId,
          vendorId: rule.payee?.type === "Vendor" ? rule.payee.id : null,
          invoiceDate: periodDate,
          status: "Due",
          memo: rule.memo,
          lines: group.items.map((a) => ({
            accountId: a.accountId,
            description: a.description,
            amount: a.amount,
            // Only an allocated share differs from the bill's own scope.
            ...(scopeKey(a.lineScope) === group.key
              ? {}
              : {
                  scopeType: a.lineScope.type,
                  scopeId: a.lineScope.id
                    ? new Types.ObjectId(String(a.lineScope.id))
                    : null,
                }),
          })),
          scope: toBillScope(group.scope),
          createdBy:
            rule.type === "Check" ? "Recurring check" : "Recurring bill",
          createdByUserId: rule.createdByUserId,
          recurringTransactionId: rule._id,
          recurringPeriodDate: periodDate,
        });
      } catch (err) {
        if (isDuplicateKeyError(err)) {
          // Each group carries its own unique key (rule, period, scope.id), so
          // a duplicate means only THIS scope was already posted. Skipping it
          // and continuing is right — aborting would discard groups that
          // legitimately posted — but it must be REPORTED. Before, this
          // `continue` was silent: no result row, no log, and the run still
          // read as a success while one scope's money never posted.
          skippedScopes.push({
            scopeKey: group.key,
            cents: group.items.reduce((s, a) => s + a.amount, 0),
            reason: "Already posted for this period",
          });
          continue;
        }
        // Roll back this period's earlier groups: no transactions in this
        // codebase, so compensate by hand. Leaving them would double up when
        // the released claim retries.
        await rollbackPeriod(created, createdJeIds, rule, periodDate);
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
            scope: group.scope,
            lines: bill.lines,
            attachmentFileId: bill.attachmentFileId,
          },
        });
        bill.journalEntryId = journalEntryId;
        await bill.save();
        created.push(bill._id);
        createdJeIds.push(journalEntryId);
      } catch (err) {
        // A bill must never survive as posted-but-unledgered. Drop this one
        // plus every earlier group in the period, then let the caller release
        // the claim so the rule retries cleanly.
        await rollbackPeriod([...created, bill._id], createdJeIds, rule, periodDate);
        throw err;
      }
    }
    return { kind: "Bill", ids: created, skippedScopes, notes: expanded.notes };
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

    // Debits carry each line's OWN scope, so an allocated share lands on its
    // property. Credits are per GROUP — the cash leaves the company that owes
    // the money, not the buildings it was apportioned to.
    const debits = expanded.lines.map((a) => {
      const { scopeType, scopeId } = toJournalLineScope(a.lineScope);
      return {
        accountId: a.accountId,
        scopeType,
        scopeId: scopeId ? new Types.ObjectId(scopeId) : null,
        unitId: a.unitId ?? null,
        description: a.description,
        debit: a.amount,
        credit: 0,
      };
    });
    const credits = groups.map((group) => {
      const { scopeType, scopeId } = toJournalLineScope(group.scope);
      return {
        accountId: cashAccountId,
        scopeType,
        scopeId: scopeId ? new Types.ObjectId(scopeId) : null,
        unitId: null,
        description: rule.memo ?? "Recurring journal entry",
        debit: 0,
        credit: group.items.reduce((s, a) => s + a.amount, 0),
      };
    });
    if (credits.every((c) => c.credit === 0)) return null;

    // Allocation is the first thing in this module that can make debits and
    // credits diverge (a buggy split). allocateCents is exactly-summing, so
    // this should never fire — which is exactly why it is worth having, since
    // an unbalanced JE would corrupt the ledger silently.
    const totalDebits = debits.reduce((s, l) => s + l.debit, 0);
    const totalCredits = credits.reduce((s, l) => s + l.credit, 0);
    if (totalDebits !== totalCredits) {
      throw new Error(
        `Recurring JE would not balance: debits ${totalDebits} vs credits ${totalCredits}`,
      );
    }

    // Header scope is advisory (reports read line scope) but drives the GL
    // index, so name the scope when the whole entry sits on exactly one.
    const headerScope: PmScope =
      groups.length === 1 ? groups[0]!.scope : { type: "Company", id: null };
    const header = toJournalLineScope(headerScope);

    // The Bill path gets its lock check inside postBillToLedger; this branch
    // has none of its own, so assert here too — across EVERY scope the entry
    // touches, not just the header's. Belt-and-braces against a race with the
    // caller's pre-claim gate.
    const lockNote = await firstLockedScope(
      String(rule.organizationId),
      periodDate,
      expanded.lines,
      ctx,
    );
    if (lockNote) throw new Error(lockNote);

    const je = await JournalEntry.create({
      organizationId: rule.organizationId,
      date: periodDate,
      scopeType: header.scopeType,
      scopeId: header.scopeId ? new Types.ObjectId(header.scopeId) : null,
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
    return {
      kind: "JournalEntry",
      ids: [je._id],
      skippedScopes,
      notes: expanded.notes,
    };
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

  // Memoized for the whole run: a 24-period catch-up over several rules on the
  // same company would otherwise re-query its properties on every period.
  const resolveCompany = createCompanyPropertyResolver(orgId);

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

      // Expand allocations ONCE per period, then use the same lines for the
      // lock gate and the artifact. Two different expansions would let the gate
      // approve scopes the writer never touches (or worse, miss ones it does).
      //
      // `periodDate` is passed so a mortgage line can derive its payment number
      // from the date rather than from a position in this loop — which is what
      // keeps a catch-up backfill identical to what the cron posts.
      const expanded = await expandRuleAmounts({
        rule,
        resolve: resolveCompany,
        periodDate,
      });

      // Bad loan terms stop THIS rule and leave the cursor untouched, exactly
      // like a locked period — never the whole run. See ExpandedRuleAmounts.
      if (expanded.errors.length > 0) {
        results.push({
          recurringTransactionId: String(rule._id),
          posted: false,
          periodDate: periodDate.toISOString(),
          note: expanded.errors.join(" "),
        });
        break;
      }

      // Locked-period gate. Check EVERY distinct scope the rule touches, not
      // just the first row's: a partial post would advance the claim and
      // permanently lose the locked property's share of this period. So it is
      // all-or-nothing.
      const lockError = await firstLockedScope(
        orgId,
        periodDate,
        expanded.lines,
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
          expanded,
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

        // A duplicate-suppressed scope used to vanish without a trace — no
        // result row, no log, and the run still reported success. Surface it.
        const skippedNote = artifact.skippedScopes.length
          ? `${artifact.skippedScopes.length} scope(s) already posted for this period and were skipped.`
          : null;
        const allNotes = [...artifact.notes, skippedNote].filter(
          (n): n is string => Boolean(n),
        );

        results.push({
          recurringTransactionId: String(rule._id),
          posted: true,
          artifactKind: artifact.kind,
          artifactIds: artifact.ids.map(String),
          periodDate: periodDate.toISOString(),
          skippedScopes: artifact.skippedScopes,
          note: allNotes.length > 0 ? allNotes.join(" ") : undefined,
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
  /**
   * One entry per posting LINE, not per artifact — an allocated company amount
   * shows up as one row per property with that property's own cents, which is
   * the whole point of a dry run for a split.
   *
   * `propertyName` carries the company name for company-scoped rows, so the
   * column reads "Property or company". `allocatedFrom*` is set only on shares
   * produced by a split, letting the UI nest them under their parent.
   */
  scopes: Array<{
    propertyId: string | null;
    propertyName: string;
    amountCents: number;
    allocatedFromCompanyId?: string | null;
    allocatedFromCompanyName?: string | null;
  }>;
  status: "will-post" | "locked" | "unsupported" | "possible-duplicate";
  note?: string;
  /** Rule-level warnings (e.g. RECURRING_MISSING_PAYEE) worth showing. */
  warnings: string[];
  /**
   * How this period's mortgage payment splits. Rendered as a sub-line rather
   * than as two `scopes` rows: both legs sit on the same scope, so two rows
   * with the same property name would read as a duplicate. `amountCents` is
   * unchanged — interest + principal is the payment.
   */
  mortgage?: {
    index: number;
    interestCents: number;
    principalCents: number;
    closingBalanceCents: number;
  };
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

  // The preview must expand allocations exactly as the writer does, or it
  // promises one line and posts four.
  //
  // PER PERIOD, not per rule. A mortgage split depends on the payment number,
  // which depends on the period date — so a single per-rule expansion would
  // show every month with January's interest. Enumerate the periods first,
  // expand each one, then resolve labels over the union: resolveScopeLabels is
  // one round-trip and must see every scope any period touches.
  const resolveCompany = createCompanyPropertyResolver(orgId);
  const workByRule = new Map<
    string,
    { periods: Date[]; expansions: ExpandedRuleAmounts[] }
  >();

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

    const expansions: ExpandedRuleAmounts[] = [];
    for (const periodDate of periods) {
      expansions.push(
        await expandRuleAmounts({ rule, resolve: resolveCompany, periodDate }),
      );
    }
    workByRule.set(String(rule._id), { periods, expansions });
  }

  // Resolve every referenced scope label up front — properties AND companies,
  // across every period of every rule.
  const labels = await resolveScopeLabels(
    Array.from(workByRule.values()).flatMap((w) =>
      w.expansions.flatMap((e) =>
        e.lines.flatMap((l) => [
          { scopeType: l.groupScope.type, scopeId: l.groupScope.id },
          { scopeType: l.lineScope.type, scopeId: l.lineScope.id },
        ]),
      ),
    ),
    orgId,
  );

  const plan: PlannedPeriod[] = [];
  const rulesWithWork = new Set<string>();

  for (const rule of rules) {
    const work = workByRule.get(String(rule._id));
    if (!work) continue;

    const warnings = (rule.warnings ?? []).map((w) =>
      typeof w === "string" ? w : (w as { code?: string }).code ?? "Warning",
    );

    rulesWithWork.add(String(rule._id));

    for (let i = 0; i < work.periods.length; i += 1) {
      const periodDate = work.periods[i]!;
      const expanded = work.expansions[i]!;
      const groups = groupPostingLines(expanded.lines);

      // One row per posting line, so an allocated share shows the property it
      // actually lands on with its own cents. `allocatedFrom` lets the UI nest
      // the shares under the company they came from.
      //
      // A mortgage's two legs share a scope, so they are collapsed into a
      // single row here and the split is surfaced via `row.mortgage` instead.
      const isMortgagePeriod = Boolean(expanded.mortgage);
      const lineRows = isMortgagePeriod
        ? collapseByScope(expanded.lines)
        : expanded.lines;
      const scopes = lineRows.map((l) => {
        const lineKey = scopeKey(l.lineScope);
        return {
          propertyId: isPropertyScope(l.lineScope)
            ? String(l.lineScope.id)
            : null,
          propertyName: labels.get(lineKey)?.label ?? "Company",
          amountCents: l.amount,
          allocatedFromCompanyId: l.allocatedFromCompanyId ?? null,
          allocatedFromCompanyName: l.allocatedFromCompanyId
            ? (labels.get(scopeKey(l.groupScope))?.label ?? null)
            : null,
        };
      });
      const amountCents = scopes.reduce((s, g) => s + g.amountCents, 0);

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
        mortgage: expanded.mortgage
          ? {
              index: expanded.mortgage.index,
              interestCents: expanded.mortgage.interestCents,
              principalCents: expanded.mortgage.principalCents,
              closingBalanceCents: expanded.mortgage.closingBalanceCents,
            }
          : undefined,
      };

      // Bad loan terms are shown as blocked rather than silently omitted — the
      // writer would stop on the same period for the same reason.
      if (expanded.errors.length > 0) {
        row.status = "unsupported";
        row.note = expanded.errors.join(" ");
        plan.push(row);
        continue;
      }

      if (groups.length === 0) {
        row.status = "unsupported";
        row.note = "Rule has no amount lines";
        plan.push(row);
        continue;
      }

      const lockNote = await firstLockedScope(
        orgId,
        periodDate,
        expanded.lines,
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
      // Surface why a line did not split (mixed currency, no properties
      // assigned), or that this is a final payment with a trued-up total, on
      // the same screen the user approves the catch-up from.
      if (expanded.notes.length > 0) {
        row.note = [row.note, ...expanded.notes].filter(Boolean).join(" ");
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
