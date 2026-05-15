// NYSE / NASDAQ / TSX share the same regular session: 09:30–16:00 America/
// New_York, Mon–Fri. No holiday calendar in v1 (PDR §10). This is the
// canonical client/server market-clock used by the TopBar pill, the 60s
// auto-refresh gate (Stage 14), and quote-TTL selection.
// Refs: PDR.md §10; Tech_Stack.md §Cron Configuration.

const OPEN_MINUTES = 9 * 60 + 30; // 09:30 ET
const CLOSE_MINUTES = 16 * 60; // 16:00 ET

interface EtParts {
  weekday: number; // 0 = Sun … 6 = Sat
  minutes: number; // minutes since ET midnight
  hms: string; // HH:MM:SS
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/** Decompose an instant into America/New_York wall-clock parts. */
function etParts(date: Date): EtParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";

  const weekday = WEEKDAY_INDEX[get("weekday")] ?? 0;
  // Intl can emit "24" for midnight under hour12:false — normalize to 0.
  let hour = Number(get("hour"));
  if (hour === 24) hour = 0;
  const minute = Number(get("minute"));
  const second = Number(get("second"));
  const pad = (n: number) => String(n).padStart(2, "0");

  return {
    weekday,
    minutes: hour * 60 + minute,
    hms: `${pad(hour)}:${pad(minute)}:${pad(second)}`,
  };
}

/** True when US/CA equity markets are in their regular session. */
export function isMarketOpen(date: Date = new Date()): boolean {
  const { weekday, minutes } = etParts(date);
  if (weekday === 0 || weekday === 6) return false;
  return minutes >= OPEN_MINUTES && minutes < CLOSE_MINUTES;
}

export interface MarketStatus {
  open: boolean;
  /** "Market Open" | "Market Closed" — ready for the TopBar pill. */
  label: string;
  /** Current ET wall-clock time, "HH:MM:SS". */
  etTime: string;
}

export function getMarketStatus(date: Date = new Date()): MarketStatus {
  const open = isMarketOpen(date);
  const { hms } = etParts(date);
  return {
    open,
    label: open ? "Market Open" : "Market Closed",
    etTime: hms,
  };
}

/** Format an instant as the TopBar timestamp, e.g. "14:32:01 ET". */
export function formatEtTime(date: Date = new Date()): string {
  return `${etParts(date).hms} ET`;
}
