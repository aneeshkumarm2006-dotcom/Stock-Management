// Helpers for <input type="date"> values (local-time YYYY-MM-DD, no timezone
// shift). Using toISOString() would convert to UTC and can roll the date back
// a day for users west of GMT, so we format from local parts instead.

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** A Date → "YYYY-MM-DD" in the user's local timezone. */
export function toDateInputValue(d: Date | string | null | undefined): string {
  if (!d) return "";
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Today as "YYYY-MM-DD" (local). */
export function todayInputValue(): string {
  return toDateInputValue(new Date());
}

/**
 * A stored lease date → "YYYY-MM-DD" anchored to the *calendar* date, ignoring
 * timezone. Lease dates are persisted as UTC midnight ("2023-03-01T00:00:00Z"),
 * so reading local parts (toDateInputValue) rolls the day back for users west of
 * GMT. Slice the UTC date parts instead so an <input type="date"> prefills the
 * exact day that was entered. Used when editing an existing lease.
 */
export function toDateInputValueUTC(d: Date | string | null | undefined): string {
  if (!d) return "";
  if (typeof d === "string") {
    const m = /^(\d{4}-\d{2}-\d{2})/.exec(d);
    if (m) return m[1] ?? "";
  }
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/**
 * A date-only value → a Date anchored to *local noon* on its calendar day.
 * Dates are stored as UTC midnight; reconstructing at local noon means the
 * calendar day can never roll across a boundary in any realistic timezone.
 * Returns null for null/empty/invalid. Use when a caller needs a Date for
 * custom formatting (e.g. date-fns `format`); prefer formatDateOnly for plain
 * localized display.
 */
export function parseDateOnly(d: Date | string | null | undefined): Date | null {
  const iso = toDateInputValueUTC(d);
  if (!iso) return null;
  const [y, mo, day] = iso.split("-").map(Number) as [number, number, number];
  return new Date(y, mo - 1, day, 12);
}

/**
 * Render a date-only value (lease start/end, invoice/paid/due dates) as a
 * localized date string without a timezone shift. Dates are stored as UTC
 * midnight; rendering them with `new Date(x).toLocaleDateString()` shows the
 * previous day in UTC-negative zones. Re-anchoring to local noon (via
 * parseDateOnly) keeps the displayed day matching what was entered, regardless
 * of the viewer's timezone. Returns "—" for null/empty.
 */
export function formatDateOnly(d: Date | string | null | undefined): string {
  return parseDateOnly(d)?.toLocaleDateString() ?? "—";
}
