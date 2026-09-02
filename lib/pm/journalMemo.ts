// Shared builders for the memo line on lease-generated journal entries.
//
// Rent JEs used to post as bare `Rent charge for lease #11`, which forces the
// reader to open the lease to learn who the charge is for. The memo now leads
// with the tenant so the General Ledger is readable at a glance.
//
// Two hard constraints shape these builders:
//
//  1. The literal `lease #N` substring MUST survive. `JournalEntry` has no
//     `leaseId` field, so the memo is the ONLY link from a posted entry back to
//     its lease — `scripts/scan-rent-issues.ts`,
//     `scripts/fix-duplicate-firstmonth-rent.ts` and
//     `scripts/backfill-historical-rent.ts` all regex it out. Truncation
//     therefore eats into the tenant label and never the `(lease #N)` tail.
//  2. `memo` is capped at JOURNAL_ENTRY_MEMO_MAX (256) by the schema, so a
//     lease with many tenants can't be allowed to overflow it.
//
// Every producer of these strings — the nightly cron, the manual "post
// recurring due now" button, the move-in promotion, and the one-shot backfill
// script — goes through this module so backfilled rows come out byte-identical
// to newly-posted ones.
import { JOURNAL_ENTRY_MEMO_MAX } from "@/lib/db/models/pm/JournalEntry";
import { tenantDisplayName, type TenantNameParts } from "@/lib/pm/tenantName";

/** A lease's denormalized tenant ref, narrowed to what labelling needs. */
export interface LeaseTenantLike extends TenantNameParts {
  isCosigner?: boolean;
}

/** How many tenant names spell out before collapsing into "+N more". */
const MAX_NAMES = 2;

/**
 * Human label for the party a lease-scoped journal entry belongs to.
 *
 * Cosigners are skipped — they guarantee the lease but aren't who the charge
 * is "for". Returns "" when a lease has no usable tenant (draft leases executed
 * before the tenant-less guard landed still exist in client data); callers must
 * treat that as "no label" and fall back to the un-prefixed memo rather than
 * emitting a dangling separator.
 */
export function leaseTenantsLabel(
  tenants: readonly LeaseTenantLike[] | undefined | null,
): string {
  const names = (tenants ?? [])
    .filter((t) => !t.isCosigner)
    .map((t) => tenantDisplayName(t).trim())
    .filter((n) => n.length > 0);
  if (names.length === 0) return "";
  if (names.length <= MAX_NAMES) return names.join(" & ");
  return `${names.slice(0, MAX_NAMES).join(" & ")} +${names.length - MAX_NAMES} more`;
}

/**
 * Assemble `<label> — <body>`, trimming the LABEL (never the body) until the
 * whole thing fits the schema cap. An empty label degrades to the bare body,
 * which is what keeps a tenant-less lease from posting "— rent charge (...)".
 */
function withTenantLabel(label: string, body: string): string {
  const name = label.trim();
  if (!name) return body.slice(0, JOURNAL_ENTRY_MEMO_MAX);
  // 3 = the " — " separator.
  const room = JOURNAL_ENTRY_MEMO_MAX - body.length - 3;
  // Body alone already fills the cap: drop the label rather than corrupt the
  // `lease #N` tail. Guard at a few chars so we never emit "N… — body".
  if (room < 4) return body.slice(0, JOURNAL_ENTRY_MEMO_MAX);
  const clipped =
    name.length <= room ? name : `${name.slice(0, room - 1)}\u2026`;
  return `${clipped} \u2014 ${body}`;
}

/** Primary rent accrual — the base-rent + recovery charge posted per period. */
export function rentChargeMemo(opts: {
  leaseNumber: number | string;
  tenantLabel: string;
  /** Free-text tail kept verbatim by the backfill (e.g. "(backfill)"). */
  suffix?: string;
}): string {
  const suffix = opts.suffix?.trim();
  const body =
    `rent charge (lease #${opts.leaseNumber})` + (suffix ? ` ${suffix}` : "");
  return withTenantLabel(opts.tenantLabel, body);
}

/** Ad-hoc `recurringCharges[]` row — the non-base-rent recurring extras. */
export function recurringChargeMemo(opts: {
  leaseNumber: number | string;
  tenantLabel: string;
  /** The charge's own memo, or its frequency when it has none. */
  detail?: string | null;
}): string {
  const detail = (opts.detail ?? "").trim();
  const body = `recurring charge${detail ? `: ${detail}` : ""} (lease #${opts.leaseNumber})`;
  return withTenantLabel(opts.tenantLabel, body);
}

/**
 * Move-in JE raised when a draft lease is executed. The property name used to
 * ride along here; the GL list already renders it in the Scope column, so the
 * tenant takes that space instead.
 */
export function moveInMemo(opts: {
  leaseNumber: number | string;
  tenantLabel: string;
}): string {
  return withTenantLabel(
    opts.tenantLabel,
    `move-in (lease #${opts.leaseNumber})`,
  );
}

// ---------------------------------------------------------------------------
// Matchers — the parsing counterpart of the builders above.
//
// Before these existed, four scripts each hand-rolled their own regex and three
// of them ANCHORED on a memo format that no longer ships: `scan-rent-issues.ts`
// and `fix-duplicate-firstmonth-rent.ts` still test `/^Move-in JE for lease #N/`
// and `/^Rent charge for lease #N\b/`, which match zero rows now that every
// memo is tenant-prefixed. A "duplicate detector" that silently matches nothing
// is worse than none, so the patterns live here beside the builders that have
// to stay in step with them.
//
// Both the CURRENT and the LEGACY shapes are accepted, because production holds
// rows written by both:
//   current  "Alebrijes — rent charge (lease #36)"
//   legacy   "Rent charge for lease #36 (backfill)"
// ---------------------------------------------------------------------------

/** Pull the lease number out of any lease-generated memo, or null. */
export function parseLeaseNumberFromMemo(
  memo: string | null | undefined,
): number | null {
  const m = /lease #(\d+)/i.exec(memo ?? "");
  return m?.[1] ? Number(m[1]) : null;
}

/**
 * A lease number is always digits, so the "escape" is a strip. Anything else
 * would be a caller bug, and interpolating it raw into a RegExp would turn that
 * bug into a pattern that quietly matches the wrong rows.
 */
function leaseNumberPattern(leaseNumber: number | string): string {
  const digits = String(leaseNumber).replace(/[^0-9]/g, "");
  if (!digits) throw new Error(`Invalid lease number: ${String(leaseNumber)}`);
  return digits;
}

/**
 * Matches the PRIMARY rent accrual for one lease.
 *
 * Deliberately narrower than `/lease #N/`: that also matches move-in JEs,
 * `recurringCharges[]` extras, late fees and deposits, so a month whose only
 * entry is a $50 parking charge would look like rent had already been posted.
 * `scripts/backfill-historical-rent.ts` keys its "seen" set that loosely, which
 * is why a backfill can skip a month that genuinely owes rent.
 *
 * The `(?!ed)` guards against "recurring charge", which also ends in
 * "charge (lease #N)" — matching it would make an extras-only month look like
 * base rent had posted.
 */
export function rentChargeMemoMatcher(leaseNumber: number | string): RegExp {
  const n = leaseNumberPattern(leaseNumber);
  return new RegExp(
    "(?:^|[^a-z])rent charge[^(]*\\(lease #" +
      n +
      "\\)|^Rent charge for lease #" +
      n +
      "\\b",
    "i",
  );
}

/** Matches the move-in JE raised when a draft lease is executed. */
export function moveInMemoMatcher(leaseNumber: number | string): RegExp {
  const n = leaseNumberPattern(leaseNumber);
  return new RegExp(
    "move-in \\(lease #" + n + "\\)|^Move-in JE for lease #" + n + "\\b",
    "i",
  );
}

/** Matches one `recurringCharges[]` row's accrual for a lease. */
export function recurringChargeMemoMatcher(
  leaseNumber: number | string,
): RegExp {
  const n = leaseNumberPattern(leaseNumber);
  return new RegExp("recurring charge[^(]*\\(lease #" + n + "\\)", "i");
}
