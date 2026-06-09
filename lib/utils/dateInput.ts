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
