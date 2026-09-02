// leaseRentCatchUp — post lease rent for periods that are ALREADY IN THE PAST.
//
// WHY THIS EXISTS. `runLeaseRecurringPoster` posts exactly one period per run
// and walks strictly forward from each lease's cursor. That is right for a
// nightly cron and useless for recovering a gap: recurring *transactions* have
// had `planRecurringCatchUp` + a "Catch up…" button for months, which is why
// Municipal Taxes shows from January while Base Rent, OPEX Recoveries and Tax
// Recoveries start in July.
//
// WHY IT DOES NOT WALK THE CURSOR FORWARD. The obvious design — mirror
// `enumeratePeriods` and step each lease's `nextDueDate` up to a `throughDate`
// — cannot recover this client's gap at all. `scripts/realign-lease-next-due-
// dates.ts` already rolled stranded cursors forward WITHOUT posting anything
// (its header: the gap months are "treated as already handled outside the
// system"), so every affected lease now sits past the months that are missing.
// A cursor-driven walk would enumerate nothing.
//
// So periods are derived from the cursor as an ANCHOR instead: each candidate
// date is computed as `anchor − k cycles`, k counted from the anchor itself
// rather than accumulated step by step. That keeps a month-end lease from
// drifting (Jan 31 → Feb 28 → Mar 28 …) across a long backfill.
//
// STRICTLY BEHIND THE CURSOR. This tool only posts periods EARLIER than the
// lease's current cursor. Everything at or after it belongs to the cron and the
// "Post recurring due now" button, which own the atomic-claim protocol. That
// boundary is what makes a catch-up safe to run while the cron is running:
// the two operate on disjoint period sets and never race for the same claim,
// and the catch-up never has to mutate a cursor at all.
//
// DUPLICATES are prevented by the database, not by this file remembering to
// check: every entry carries `leaseId` + `leaseChargeKey` + `leasePeriodDate`,
// covered by a unique partial index (lib/db/models/pm/JournalEntry.ts). The
// in-memory probe below is belt-and-braces for rows written before those fields
// existed, matched via the memo helpers in lib/pm/journalMemo.ts — and the
// backfill in scripts/backfill-lease-rent-keys.ts must have been run first, or
// historical entries are invisible to the index.
//
// NOTHING IS EVER SKIPPED SILENTLY. `resolveScheduledRentForDate` returns null
// for three quite different reasons — no active Term, a Term with no base
// income account (a data error that silently zeroes rent), and a zero total —
// and the nightly poster collapses all three into "release the claim and move
// on", pushing no result row at all. Every period here comes back with a
// status, so a preview that recovers 4 of 6 months says why the other 2 did
// not.
import { Types } from "mongoose";
import { connectToDatabase } from "@/lib/db/mongoose";
import { Lease } from "@/lib/db/models/pm/Lease";
import { Property } from "@/lib/db/models/pm/Property";
import { ChartOfAccount } from "@/lib/db/models/pm/ChartOfAccount";
import { JournalEntry } from "@/lib/db/models/pm/JournalEntry";
import { logActivity } from "@/lib/pm/activity";
import { assertWriteAllowed, LockedPeriodError } from "@/lib/pm/lockedPeriod";
import { buildRentChargeLines } from "@/lib/pm/rentCharge";
import {
  activeTermPeriodForDate,
  resolveScheduledRentForDate,
} from "@/lib/pm/rentSchedule";
import {
  leaseTenantsLabel,
  moveInMemoMatcher,
  rentChargeMemo,
  rentChargeMemoMatcher,
  recurringChargeMemo,
  recurringChargeMemoMatcher,
} from "@/lib/pm/journalMemo";
import { ledgerVisibleMatch } from "@/lib/pm/ledgerVisibility";
import { parseDateWindow } from "@/lib/pm/dateWindow";
import type { PmContext } from "@/lib/auth/getCurrentUser";
import type { RentCycle } from "@/types/pm";

/** The cursor a period belongs to. Base rent shares one key; each ad-hoc
 *  `recurringCharges[]` row gets its own, because a lease can legitimately post
 *  base rent AND several extras on the same date. */
export const PRIMARY_RENT_KEY = "primary-rent";

export type RentCatchUpStatus =
  /** Ready to post. */
  | "will-post"
  /** A journal entry already covers this lease + charge + period. */
  | "already-posted"
  /** The move-in entry raised at execution already carries this month's rent. */
  | "covered-by-move-in"
  /** A rent schedule exists but no Term covers the date (gap, or an
   *  unexercised renewal option). */
  | "no-active-term"
  /** A Term covers the date but has no base income account — a DATA ERROR that
   *  silently posts nothing, not a legitimate "nothing due". */
  | "term-missing-base-account"
  /** The resolved rent came to zero. */
  | "zero-amount"
  /** A locked period blocks the write. */
  | "locked"
  /** At or after the lease's own cursor — the cron and the "Post recurring due
   *  now" button own these, so the catch-up leaves them alone. */
  | "handled-by-scheduler"
  /** The lease was not yet active, or had already ended. */
  | "outside-lease-term"
  /** Posting threw. */
  | "failed";

/** Statuses that mean "money is missing and this run did not fix it". */
const BLOCKING: ReadonlySet<RentCatchUpStatus> = new Set<RentCatchUpStatus>([
  "no-active-term",
  "term-missing-base-account",
  "locked",
  "failed",
]);

export interface RentCatchUpPeriod {
  leaseId: string;
  leaseNumber: number;
  leaseStatus: string;
  tenantLabel: string;
  propertyId: string;
  propertyName: string;
  chargeKey: string;
  /** What the charge is, for the preview: "Base rent" or the row's memo. */
  chargeLabel: string;
  /** UTC-midnight ISO date of the period. */
  periodDate: string;
  status: RentCatchUpStatus;
  amountCents: number;
  /** Base / OPEX / tax split, so a preview can show what it would credit. */
  breakdown: { baseCents: number; opexCents: number; taxCents: number };
  /** Where the amount came from — a Term label, or the legacy primary rent. */
  source: string;
  note?: string;
  journalEntryId?: string;
}

export interface RentCatchUpPlan {
  from: string;
  through: string;
  periods: RentCatchUpPeriod[];
  totals: {
    willPost: number;
    willPostCents: number;
    alreadyPosted: number;
    blocked: number;
    skipped: number;
  };
  /** Set when a cap stopped the enumeration — never truncate silently. */
  truncated?: string;
}

export interface RentCatchUpOptions {
  orgId: string;
  /** Inclusive window bounds, `YYYY-MM-DD` or a Date. */
  from: string | Date;
  through: string | Date;
  /** Restrict to specific leases (their `_id`s). */
  leaseIds?: string[];
  /**
   * Include leases that have since Ended/Expired.
   *
   * Off by default because the nightly poster only sweeps Active/Future and
   * surprising a client with rent on a closed lease is worse than omitting it.
   * But a lease that ran Jan–Jun and expired in June genuinely owes those
   * months, so the preview always LISTS them and this flag posts them.
   */
  includeExpired?: boolean;
  /** Actor for the locked-period gate. A catch-up runs as the human. */
  ctx: PmContext;
}

/** Hard stop on how many periods one lease-charge can enumerate. */
const MAX_PERIODS_PER_CHARGE = 60;
/** Hard stop across the whole run. */
const MAX_PERIODS_TOTAL = 2000;

const MONTHS_PER_CYCLE: Partial<Record<RentCycle, number>> = {
  Monthly: 1,
  Quarterly: 3,
  Yearly: 12,
};
const DAYS_PER_CYCLE: Partial<Record<RentCycle, number>> = {
  Weekly: 7,
  "Bi-weekly": 14,
};

function utcDay(d: Date): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
}

function daysInUtcMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

/**
 * `anchor` shifted by `steps` cycles (negative = backwards), clamped to the
 * target month's length.
 *
 * Always measured from the anchor, never from the previous result, so a lease
 * anchored on the 31st yields Jan 31 / Feb 28 / Mar 31 instead of collapsing to
 * the 28th for the rest of time the way iterative stepping does.
 */
function shiftFromAnchor(
  anchor: Date,
  cycle: RentCycle,
  steps: number,
): Date | null {
  const days = DAYS_PER_CYCLE[cycle];
  if (days) {
    return new Date(anchor.getTime() + steps * days * 24 * 60 * 60 * 1000);
  }
  const months = MONTHS_PER_CYCLE[cycle];
  if (!months) return null;
  const anchorDay = anchor.getUTCDate();
  const target = new Date(
    Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + steps * months, 1),
  );
  const y = target.getUTCFullYear();
  const m = target.getUTCMonth();
  return new Date(Date.UTC(y, m, Math.min(anchorDay, daysInUtcMonth(y, m))));
}

/**
 * Every period date for one cursor that falls inside [from, through) and
 * strictly before the cursor itself.
 *
 * `cursor` is the anchor AND the upper bound: this tool deliberately owns only
 * the past (see the header).
 */
function enumeratePastPeriods(
  cursor: Date,
  cycle: RentCycle,
  from: Date,
  through: Date,
): { periods: Date[]; truncated: boolean } {
  const anchor = utcDay(cursor);
  const lo = utcDay(from);
  const hi = utcDay(through);
  const out: Date[] = [];
  let truncated = false;

  for (let k = 1; k <= MAX_PERIODS_PER_CHARGE + 1; k += 1) {
    const d = shiftFromAnchor(anchor, cycle, -k);
    if (!d) break; // unsupported cycle
    if (d.getTime() < lo.getTime()) break;
    if (k > MAX_PERIODS_PER_CHARGE) {
      truncated = true;
      break;
    }
    if (d.getTime() <= hi.getTime()) out.push(d);
  }
  return { periods: out.reverse(), truncated };
}

interface HistoryProbe {
  /** `${leaseId}|${chargeKey}|${YYYY-MM-DD}` for entries carrying the keys. */
  keyed: Map<string, string>;
  /** Memo-matched entries for rows written before the keys existed. */
  legacy: Array<{ id: string; memo: string; month: string }>;
  /** Move-in entries by lease number → set of `YYYY-MM`. */
  moveIn: Map<number, Set<string>>;
}

const monthOf = (d: Date) => d.toISOString().slice(0, 7);
const dayOf = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Load every lease-generated entry once, rather than querying per period.
 *
 * A catch-up over 6 months × 40 leases is 240 probes; one scan is a single
 * round trip and lets the legacy memo match run in memory.
 */
async function loadHistory(
  orgObjectId: Types.ObjectId,
  from: Date,
  through: Date,
): Promise<HistoryProbe> {
  const rows = await JournalEntry.find({
    organizationId: orgObjectId,
    ...ledgerVisibleMatch(),
    date: {
      // A month's entry can legitimately sit a few days either side of the
      // period date, so widen the probe window rather than miss one and post a
      // duplicate.
      $gte: new Date(from.getTime() - 45 * 24 * 60 * 60 * 1000),
      $lt: new Date(through.getTime() + 45 * 24 * 60 * 60 * 1000),
    },
    $or: [{ leaseId: { $type: "objectId" } }, { memo: /lease #\d+/i }],
  })
    .select({
      _id: 1,
      memo: 1,
      date: 1,
      leaseId: 1,
      leaseChargeKey: 1,
      leasePeriodDate: 1,
    })
    .lean<
      Array<{
        _id: Types.ObjectId;
        memo?: string;
        date: Date;
        leaseId?: Types.ObjectId | null;
        leaseChargeKey?: string | null;
        leasePeriodDate?: Date | null;
      }>
    >();

  const keyed = new Map<string, string>();
  const legacy: HistoryProbe["legacy"] = [];
  const moveIn = new Map<number, Set<string>>();

  for (const r of rows) {
    if (r.leaseId && r.leaseChargeKey && r.leasePeriodDate) {
      keyed.set(
        `${String(r.leaseId)}|${r.leaseChargeKey}|${dayOf(new Date(r.leasePeriodDate))}`,
        String(r._id),
      );
    }
    const memo = r.memo ?? "";
    if (memo) {
      legacy.push({
        id: String(r._id),
        memo,
        month: monthOf(new Date(r.date)),
      });
    }
  }
  return { keyed, legacy, moveIn };
}

interface LeaseLike {
  _id: Types.ObjectId;
  leaseNumber: number;
  status: string;
  startDate?: Date | null;
  endDate?: Date | null;
  rentCycle: RentCycle;
  propertyId: Types.ObjectId;
  unitId: Types.ObjectId;
  primaryRent?: { nextDueDate?: Date | null } | null;
  recurringCharges?: Array<{
    _id?: Types.ObjectId;
    nextDate?: Date | null;
    frequency: RentCycle;
    amount: number;
    accountId: Types.ObjectId;
    memo?: string | null;
  }>;
  tenants?: Parameters<typeof leaseTenantsLabel>[0];
  rentSchedule?: unknown;
  splitRentCharges?: unknown;
}

/**
 * Build the plan. Pure read — safe to call for any authenticated user, which is
 * what lets a bookkeeper see what WOULD post without being able to post it.
 */
export async function planLeaseRentCatchUp(
  opts: RentCatchUpOptions,
): Promise<RentCatchUpPlan> {
  await connectToDatabase();
  const orgObjectId = new Types.ObjectId(opts.orgId);
  const window = parseDateWindow(opts.from, opts.through);
  const from = window.start ?? utcDay(new Date());
  // `parseDateWindow` returns a half-open end; the last INCLUSIVE day is one
  // millisecond earlier.
  const through = window.endExclusive
    ? utcDay(new Date(window.endExclusive.getTime() - 1))
    : from;

  const leaseFilter: Record<string, unknown> = {
    organizationId: orgObjectId,
  };
  if (opts.leaseIds?.length) {
    leaseFilter._id = {
      $in: opts.leaseIds
        .filter((id) => Types.ObjectId.isValid(id))
        .map((id) => new Types.ObjectId(id)),
    };
  }
  // Always LOAD ended leases — one that ran Jan–Jun and expired still owes
  // those months, and dropping it here would make the gap invisible. Whether
  // they post is `includeExpired`; whether they are reported is never optional.
  leaseFilter.status = { $nin: ["Cancelled"] };

  const leases = await Lease.find(leaseFilter)
    .sort({ leaseNumber: 1 })
    .lean<LeaseLike[]>();

  const propertyRows = await Property.find({ organizationId: orgObjectId })
    .select({ _id: 1, propertyName: 1 })
    .lean<Array<{ _id: Types.ObjectId; propertyName?: string }>>();
  const propertyNames = new Map(
    propertyRows.map((p) => [String(p._id), p.propertyName ?? "(unnamed)"]),
  );

  const history = await loadHistory(orgObjectId, from, through);

  const periods: RentCatchUpPeriod[] = [];
  let truncated: string | undefined;

  for (const lease of leases) {
    if (periods.length >= MAX_PERIODS_TOTAL) {
      truncated = `Stopped at ${MAX_PERIODS_TOTAL} periods; narrow the window or select fewer leases.`;
      break;
    }
    const tenantLabel = leaseTenantsLabel(lease.tenants);
    const propertyName =
      propertyNames.get(String(lease.propertyId)) ?? "(unknown property)";
    const rentMatcher = rentChargeMemoMatcher(lease.leaseNumber);
    const moveMatcher = moveInMemoMatcher(lease.leaseNumber);
    const recurringMatcher = recurringChargeMemoMatcher(lease.leaseNumber);

    const cursors: Array<{
      key: string;
      label: string;
      cursor: Date | null | undefined;
      cycle: RentCycle;
      isPrimary: boolean;
      charge?: NonNullable<LeaseLike["recurringCharges"]>[number];
    }> = [
      {
        key: PRIMARY_RENT_KEY,
        label: "Base rent",
        cursor: lease.primaryRent?.nextDueDate,
        cycle: lease.rentCycle,
        isPrimary: true,
      },
      ...(lease.recurringCharges ?? [])
        .filter((c) => c._id && c.nextDate)
        .map((c) => ({
          key: String(c._id),
          label: c.memo?.trim() || `Recurring ${c.frequency}`,
          cursor: c.nextDate,
          cycle: c.frequency,
          isPrimary: false,
          charge: c,
        })),
    ];

    for (const cursorSpec of cursors) {
      if (!cursorSpec.cursor) continue;
      const { periods: dates, truncated: hitCap } = enumeratePastPeriods(
        cursorSpec.cursor,
        cursorSpec.cycle,
        from,
        through,
      );
      if (hitCap && !truncated) {
        truncated = `Lease #${lease.leaseNumber} hit the ${MAX_PERIODS_PER_CHARGE}-period cap; earlier periods were not enumerated.`;
      }

      for (const periodDate of dates) {
        const row: RentCatchUpPeriod = {
          leaseId: String(lease._id),
          leaseNumber: lease.leaseNumber,
          leaseStatus: lease.status,
          tenantLabel,
          propertyId: String(lease.propertyId),
          propertyName,
          chargeKey: cursorSpec.key,
          chargeLabel: cursorSpec.label,
          periodDate: dayOf(periodDate),
          status: "will-post",
          amountCents: 0,
          breakdown: { baseCents: 0, opexCents: 0, taxCents: 0 },
          source: "",
        };

        // -- lease term ------------------------------------------------------
        const start = lease.startDate
          ? utcDay(new Date(lease.startDate))
          : null;
        const end = lease.endDate ? utcDay(new Date(lease.endDate)) : null;
        if (
          (start && periodDate.getTime() < start.getTime()) ||
          (end && periodDate.getTime() > end.getTime())
        ) {
          row.status = "outside-lease-term";
          periods.push(row);
          continue;
        }

        // -- already posted --------------------------------------------------
        const keyedHit = history.keyed.get(
          `${row.leaseId}|${row.chargeKey}|${row.periodDate}`,
        );
        if (keyedHit) {
          row.status = "already-posted";
          row.journalEntryId = keyedHit;
          periods.push(row);
          continue;
        }
        const month = monthOf(periodDate);
        const matcher = cursorSpec.isPrimary ? rentMatcher : recurringMatcher;
        const legacyHit = history.legacy.find(
          (e) => e.month === month && matcher.test(e.memo),
        );
        if (legacyHit) {
          row.status = "already-posted";
          row.journalEntryId = legacyHit.id;
          row.note = "matched by memo (entry predates the lease keys)";
          periods.push(row);
          continue;
        }

        // -- covered by the move-in entry ------------------------------------
        // `leasingPromotion` pre-advances the cursor when the move-in JE
        // carries month 1's rent, but leaves no marker on the entry, so the
        // memo is the only signal. It credits base rent AND every split, so the
        // whole period is covered.
        if (cursorSpec.isPrimary) {
          const moveHit = history.legacy.find(
            (e) => e.month === month && moveMatcher.test(e.memo),
          );
          if (moveHit) {
            row.status = "covered-by-move-in";
            row.journalEntryId = moveHit.id;
            periods.push(row);
            continue;
          }
        }

        // -- resolve the amount ----------------------------------------------
        if (cursorSpec.isPrimary) {
          const schedule = (lease.rentSchedule ?? []) as unknown[];
          if (schedule.length > 0) {
            const term = activeTermPeriodForDate(
              schedule as Parameters<typeof activeTermPeriodForDate>[0],
              periodDate,
            );
            if (!term) {
              row.status = "no-active-term";
              row.note =
                "the rent schedule has no Term covering this date (a gap, or an unexercised renewal option)";
              periods.push(row);
              continue;
            }
            if (!term.baseAccountId) {
              row.status = "term-missing-base-account";
              row.source = term.label ?? "Term";
              row.note =
                "this Term has no base income account, so nothing can post — fix the schedule";
              periods.push(row);
              continue;
            }
            row.source = term.label ?? "Term";
          } else {
            row.source = "primary rent (no schedule)";
          }

          const src = resolveScheduledRentForDate(
            lease as unknown as Parameters<
              typeof resolveScheduledRentForDate
            >[0],
            periodDate,
          );
          const built = src
            ? buildRentChargeLines(src, new Types.ObjectId())
            : null;
          if (!src || !built) {
            row.status = "zero-amount";
            periods.push(row);
            continue;
          }
          row.amountCents = built.total;
          row.breakdown.baseCents = src.primaryRent?.amount ?? 0;
          for (const s of src.splitRentCharges ?? []) {
            if (/tax/i.test(s.memo ?? "")) row.breakdown.taxCents += s.amount;
            else row.breakdown.opexCents += s.amount;
          }
        } else {
          const amount = cursorSpec.charge?.amount ?? 0;
          row.source = "recurring charge";
          if (amount <= 0) {
            row.status = "zero-amount";
            periods.push(row);
            continue;
          }
          row.amountCents = amount;
          row.breakdown.baseCents = amount;
        }

        // -- lease status ----------------------------------------------------
        const active = lease.status === "Active" || lease.status === "Future";
        if (!active && !opts.includeExpired) {
          row.status = "handled-by-scheduler";
          row.note = `lease is ${lease.status}; tick "include ended leases" to post it`;
          periods.push(row);
          continue;
        }

        // -- locked period ---------------------------------------------------
        try {
          await assertWriteAllowed({
            orgId: opts.orgId,
            txnDate: periodDate,
            scopePropertyId: String(lease.propertyId),
            ctx: opts.ctx,
          });
        } catch (err) {
          if (err instanceof LockedPeriodError) {
            row.status = "locked";
            row.note = err.policyMessage;
            periods.push(row);
            continue;
          }
          throw err;
        }

        periods.push(row);
      }
    }
  }

  const willPost = periods.filter((p) => p.status === "will-post");
  return {
    from: dayOf(from),
    through: dayOf(through),
    periods,
    totals: {
      willPost: willPost.length,
      willPostCents: willPost.reduce((s, p) => s + p.amountCents, 0),
      alreadyPosted: periods.filter(
        (p) =>
          p.status === "already-posted" || p.status === "covered-by-move-in",
      ).length,
      blocked: periods.filter((p) => BLOCKING.has(p.status)).length,
      skipped: periods.filter(
        (p) =>
          p.status === "outside-lease-term" ||
          p.status === "handled-by-scheduler" ||
          p.status === "zero-amount",
      ).length,
    },
    ...(truncated ? { truncated } : {}),
  };
}

/**
 * Post everything the plan says is postable.
 *
 * Re-plans internally rather than trusting a plan handed in from the client —
 * a preview the user looked at ten minutes ago is not authority to write.
 */
export async function runLeaseRentCatchUp(
  opts: RentCatchUpOptions,
): Promise<RentCatchUpPlan> {
  const plan = await planLeaseRentCatchUp(opts);
  const orgObjectId = new Types.ObjectId(opts.orgId);

  const arCoa = await ChartOfAccount.findOne({
    organizationId: orgObjectId,
    defaultFor: "Accounts Receivable",
    active: true,
  })
    .select({ _id: 1 })
    .lean<{ _id: Types.ObjectId } | null>();
  if (!arCoa) {
    for (const p of plan.periods) {
      if (p.status === "will-post") {
        p.status = "failed";
        p.note = "no Accounts Receivable chart-of-account is configured";
      }
    }
    return recount(plan);
  }

  const leaseCache = new Map<string, LeaseLike | null>();
  let postedCount = 0;

  for (const row of plan.periods) {
    if (row.status !== "will-post") continue;

    let lease = leaseCache.get(row.leaseId);
    if (lease === undefined) {
      lease = await Lease.findOne({
        _id: new Types.ObjectId(row.leaseId),
        organizationId: orgObjectId,
      }).lean<LeaseLike>();
      leaseCache.set(row.leaseId, lease);
    }
    if (!lease) {
      row.status = "failed";
      row.note = "lease disappeared mid-run";
      continue;
    }

    const periodDate = new Date(`${row.periodDate}T00:00:00.000Z`);
    const tenantLabel = leaseTenantsLabel(lease.tenants);

    let lines;
    let memo: string;
    if (row.chargeKey === PRIMARY_RENT_KEY) {
      const src = resolveScheduledRentForDate(
        lease as unknown as Parameters<typeof resolveScheduledRentForDate>[0],
        periodDate,
      );
      const built = src ? buildRentChargeLines(src, arCoa._id) : null;
      if (!built) {
        row.status = "zero-amount";
        continue;
      }
      lines = built.lines;
      row.amountCents = built.total;
      memo = rentChargeMemo({
        leaseNumber: lease.leaseNumber,
        tenantLabel,
      });
    } else {
      const charge = (lease.recurringCharges ?? []).find(
        (c) => String(c._id) === row.chargeKey,
      );
      if (!charge) {
        row.status = "failed";
        row.note = "the recurring charge row no longer exists";
        continue;
      }
      lines = [
        {
          accountId: arCoa._id,
          scopeType: "Property" as const,
          scopeId: lease.propertyId,
          unitId: lease.unitId,
          description: "Recurring rent receivable",
          debit: charge.amount,
          credit: 0,
        },
        {
          accountId: charge.accountId,
          scopeType: "Property" as const,
          scopeId: lease.propertyId,
          unitId: lease.unitId,
          description: "Recurring rent income",
          debit: 0,
          credit: charge.amount,
        },
      ];
      memo = recurringChargeMemo({
        leaseNumber: lease.leaseNumber,
        tenantLabel,
        detail: charge.memo ?? charge.frequency,
      });
    }

    try {
      const je = await JournalEntry.create({
        organizationId: orgObjectId,
        date: periodDate,
        scopeType: "Property",
        scopeId: lease.propertyId,
        memo,
        lines,
        status: "Posted",
        postedAt: new Date(),
        // The duplicate guard. Without these three the unique partial index
        // does not apply to the row at all.
        leaseId: lease._id,
        leaseChargeKey: row.chargeKey,
        leasePeriodDate: periodDate,
        createdByUserId: new Types.ObjectId(opts.ctx.userId),
      });
      row.journalEntryId = String(je._id);
      postedCount += 1;
    } catch (err) {
      // E11000 means the unique index caught a period this run had classified
      // as postable — a concurrent cron or a second operator got there first.
      // That is the index doing its job, so report it as already-posted rather
      // than as a failure.
      const message = err instanceof Error ? err.message : String(err);
      if (/E11000/.test(message)) {
        row.status = "already-posted";
        row.note = "posted concurrently by another run";
      } else {
        row.status = "failed";
        row.note = message;
      }
    }
  }

  if (postedCount > 0) {
    const byLease = new Map<string, number>();
    for (const p of plan.periods) {
      if (p.journalEntryId && p.status === "will-post") {
        byLease.set(p.leaseId, (byLease.get(p.leaseId) ?? 0) + 1);
      }
    }
    for (const [leaseId, count] of Array.from(byLease.entries())) {
      await logActivity({
        orgId: opts.orgId,
        parentType: "Lease",
        parentId: new Types.ObjectId(leaseId),
        eventType: "Rent catch-up posted",
        actorUserId: opts.ctx.userId,
        payload: { count, from: plan.from, through: plan.through },
      });
    }
  }

  return recount(plan);
}

function recount(plan: RentCatchUpPlan): RentCatchUpPlan {
  const posted = plan.periods.filter(
    (p) => p.status === "will-post" && p.journalEntryId,
  );
  plan.totals = {
    willPost: posted.length,
    willPostCents: posted.reduce((s, p) => s + p.amountCents, 0),
    alreadyPosted: plan.periods.filter(
      (p) => p.status === "already-posted" || p.status === "covered-by-move-in",
    ).length,
    blocked: plan.periods.filter((p) => BLOCKING.has(p.status)).length,
    skipped: plan.periods.filter(
      (p) =>
        p.status === "outside-lease-term" ||
        p.status === "handled-by-scheduler" ||
        p.status === "zero-amount",
    ).length,
  };
  return plan;
}
