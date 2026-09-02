// The canonical ledger date window — one parser shared by every report that
// takes `?from=YYYY-MM-DD&to=YYYY-MM-DD`.
//
// THE BUG THIS EXISTS TO KILL
// ---------------------------
// Every report used to build its own clause as:
//
//   if (to) dateClause.$lte = new Date(to);
//
// `new Date("2026-08-31")` is `2026-08-31T00:00:00.000Z` — the *first* instant
// of the last day, not the last. Any entry dated on the window's closing day
// with a non-zero time was therefore silently dropped from the P&L, from the
// GL drill-through, and from the "not reflected here" banner, all at once and
// all agreeing with each other. Most ledger dates are UTC midnight so the hole
// is small, but it is not empty: a move-in JE takes `new Date()` at the moment
// of promotion (lib/pm/leasingPromotion.ts), so it carries a real timestamp.
//
// WHY NOT `setHours(23, 59, 59, 999)`
// -----------------------------------
// That is what lib/../balance-sheet/route.ts does, and it is wrong for the same
// family of reasons: `setHours` is LOCAL, so on a host west of GMT it resolves
// past midnight UTC and pulls the following day into the window. A half-open
// UTC interval — `date >= from AND date < to + 1 day` — has no such edge and
// needs no fencepost arithmetic at the call site.
//
// PURITY CONTRACT: no mongoose, no models, nothing under lib/db. This is plain
// date math, and `withinDateWindow` is used by lib/pm/billReflection.ts to
// classify in memory using exactly the bounds the aggregation matched on.

/** A half-open UTC interval: `start <= date < endExclusive`. */
export interface DateWindow {
  start: Date | null;
  endExclusive: Date | null;
}

/** Midnight UTC on the calendar day `value` names, or null if unparseable. */
function utcDayStart(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
}

/**
 * Parse an inclusive `from`/`to` pair into a half-open UTC interval.
 *
 * `to` is INCLUSIVE of its whole calendar day — that is the contract every
 * caller already documented and none of them implemented.
 */
export function parseDateWindow(
  from: string | Date | null | undefined,
  to: string | Date | null | undefined,
): DateWindow {
  const start = utcDayStart(from);
  const toDay = utcDayStart(to);
  const endExclusive = toDay
    ? new Date(
        Date.UTC(
          toDay.getUTCFullYear(),
          toDay.getUTCMonth(),
          toDay.getUTCDate() + 1,
        ),
      )
    : null;
  return { start, endExclusive };
}

/**
 * The Mongo clause for a window, or null when it is unbounded on both sides.
 * Callers assign it to `filter.date` / a `$match` stage only when non-null, so
 * an unbounded window never adds an empty `{}` predicate.
 */
export function dateWindowClause(
  window: DateWindow,
): Record<string, Date> | null {
  const clause: Record<string, Date> = {};
  if (window.start) clause.$gte = window.start;
  if (window.endExclusive) clause.$lt = window.endExclusive;
  return Object.keys(clause).length > 0 ? clause : null;
}

/** In-memory counterpart of `dateWindowClause`, for classifiers. */
export function withinDateWindow(
  date: Date | null | undefined,
  window: DateWindow,
): boolean {
  if (!date) return false;
  const t = new Date(date).getTime();
  if (Number.isNaN(t)) return false;
  if (window.start && t < window.start.getTime()) return false;
  if (window.endExclusive && t >= window.endExclusive.getTime()) return false;
  return true;
}
