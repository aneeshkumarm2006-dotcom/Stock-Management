// The canonical PM ledger scope — one predicate, one key, one set of converters.
//
// A scoped row (journal line, bill, deposit item, budget, recurring amount
// line) points at either a Property or a CompanyAccount. Before this module the
// predicate `scopeType === 'Property' && scopeId` was re-implemented inline in
// ~25 places with two different "company" sentinels, which is exactly why a
// Company scope could never carry a real CompanyAccount id: every write path
// independently decided to null it out.
//
// This file drives bill splitting, the recurring JE's balancing legs, the
// locked-period gate and the recurring list's scope label — so those four can
// never disagree about where a rule posts. (Inherited verbatim from the old
// `groupAmountsByScope` doc-comment in lib/pm/recurringPoster.ts.)
//
// PURITY CONTRACT: this module must never import mongoose, a model, or
// anything under lib/db. `components/pm/EditRecurringCheckModal.tsx` and the
// recurring list page run `scopeKey`/`normalizeScope` in the browser — a
// mongoose import here would pull the driver into the client bundle. Anything
// that needs the database lives in lib/pm/scopeQuery.ts instead.

/** Structural id: an ObjectId, a string, or anything with a sane toString. */
export type IdLike = string | { toString(): string };

export type PmScopeType = "Property" | "Company";

/**
 * A resolved scope.
 *
 * `{ type: 'Company', id: null }` is and remains legal: every Company-scoped
 * row written before named companies existed carries `scopeId: null`, and it
 * means "the organization's own books". We never rewrite those — see the
 * backward-compatibility note in lib/db/models/pm/JournalEntry.ts.
 */
export type PmScope =
  | { type: "Property"; id: IdLike }
  | { type: "Company"; id: IdLike | null };

/** The raw persisted shape, as it appears on every scoped model. */
export interface ScopeLike {
  scopeType?: string | null;
  scopeId?: IdLike | null;
}

/** `Bill.scope` uses `{type, id}` rather than `{scopeType, scopeId}`. */
export interface BillScopeLike {
  type?: string | null;
  id?: IdLike | null;
}

const HEX24 = /^[a-f\d]{24}$/i;

function asId(v: IdLike | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const s = typeof v === "string" ? v : String(v);
  return HEX24.test(s) ? s : null;
}

/**
 * THE canonical predicate. A row is Property-scoped **iff** its `scopeType` is
 * exactly `'Property'` AND it names a real id. Everything else is Company —
 * which is byte-identical to how every existing call site already degrades a
 * `{Property, null}` row, so normalising through here changes no behaviour for
 * any row that exists today.
 */
export function normalizeScope(raw: ScopeLike | null | undefined): PmScope {
  const id = asId(raw?.scopeId);
  if (raw?.scopeType === "Property" && id) return { type: "Property", id };
  // A Company row keeps its id when it has one; a stray id on a non-Company,
  // non-Property row is dropped rather than silently reinterpreted.
  return { type: "Company", id: raw?.scopeType === "Company" ? id : null };
}

export function isPropertyScope(
  s: PmScope,
): s is { type: "Property"; id: IdLike } {
  return s.type === "Property";
}

/** A Company scope that names a specific CompanyAccount (not the legacy bucket). */
export function isNamedCompanyScope(s: PmScope): boolean {
  return s.type === "Company" && asId(s.id) !== null;
}

export function scopesEqual(a: PmScope, b: PmScope): boolean {
  return scopeKey(a) === scopeKey(b);
}

/**
 * Internal grouping key. **Never put this on the wire** — the two report routes
 * have their own baked-in sentinels; use `scopeReportKey` for those.
 *
 * Prefixed on purpose: a Property id and a CompanyAccount id are both
 * ObjectIds, so an unprefixed key would let them collide in the same Map. That
 * collision is precisely what made the old bare `'company'` sentinel
 * unextendable to more than one company.
 */
export function scopeKey(s: PmScope): string {
  if (s.type === "Property") return `P:${asId(s.id) ?? "-"}`;
  return `C:${asId(s.id) ?? "-"}`;
}

export function scopeKeyOf(raw: ScopeLike | null | undefined): string {
  return scopeKey(normalizeScope(raw));
}

/** The property id, or null for any Company scope. Bridges older signatures. */
export function scopePropertyIdOf(s: PmScope): string | null {
  return s.type === "Property" ? asId(s.id) : null;
}

/** The CompanyAccount id, or null for a Property scope / the legacy bucket. */
export function scopeCompanyIdOf(s: PmScope): string | null {
  return s.type === "Company" ? asId(s.id) : null;
}

// ---------------------------------------------------------------------------
// Converters — these replace the hard-coded `scopeId: null` literals that used
// to live in recurringPoster, postBillToLedger, managementFees, reconciliation,
// deposits, EFT approval and the four client modals.
// ---------------------------------------------------------------------------

export function toJournalLineScope(s: PmScope): {
  scopeType: PmScopeType;
  scopeId: string | null;
} {
  return { scopeType: s.type, scopeId: asId(s.id) };
}

export function toBillScope(s: PmScope): {
  type: PmScopeType;
  id: string | null;
} {
  return { type: s.type, id: asId(s.id) };
}

export function scopeFromBillScope(
  scope: BillScopeLike | null | undefined,
): PmScope {
  return normalizeScope({ scopeType: scope?.type, scopeId: scope?.id });
}

/**
 * Legacy bridge for call sites that only ever had a property id and inferred
 * the type from its truthiness (lib/pm/postBillToLedger.ts did this at the
 * point where the whole feature became impossible). Reproduces that inference
 * exactly, so passing it through changes nothing.
 */
export function scopeFromPropertyId(id: IdLike | null | undefined): PmScope {
  const pid = asId(id);
  return pid ? { type: "Property", id: pid } : { type: "Company", id: null };
}

/** Build a scope from a client-side picker pair, tolerating `""` for "none". */
export function scopeFromInput(
  scopeType: string | null | undefined,
  scopeId: string | null | undefined,
): PmScope {
  return normalizeScope({ scopeType, scopeId: scopeId || null });
}

// ---------------------------------------------------------------------------
// Report keys — the wire contract
// ---------------------------------------------------------------------------

/**
 * The two report aggregators each bake a different literal into their response,
 * and both are read by client pages that switch on it:
 *
 *   - /api/pm/financials/matrix     → column id `'company'`
 *   - /api/pm/company-financials    → rollup key `'__company__'`
 *
 * Unifying them would break both clients for no gain, so we unify the
 * *derivation* and keep the wire. `splitByCompany` is the forward door: with it
 * off (the default, and what both routes pass today) every Company row —
 * legacy-null and id-carrying alike — collapses onto the bare sentinel, so
 * neither response shifts by a byte when companies start carrying real ids.
 */
export const COMPANY_SENTINEL = {
  matrix: "company",
  companyFinancials: "__company__",
} as const;

export function scopeReportKey(
  raw: ScopeLike | null | undefined,
  sentinel: string,
  opts?: { splitByCompany?: boolean },
): string {
  const s = normalizeScope(raw);
  if (s.type === "Property") return asId(s.id)!;
  const companyId = asId(s.id);
  if (!opts?.splitByCompany || !companyId) return sentinel;
  return `${sentinel}:${companyId}`;
}

/** True for the bare sentinel and for any `sentinel:<id>` company column. */
export function isCompanyColumnId(id: string, sentinel: string): boolean {
  return id === sentinel || id.startsWith(`${sentinel}:`);
}

/** The CompanyAccount id embedded in a company column id, when there is one. */
export function companyIdFromColumnId(
  id: string,
  sentinel: string,
): string | null {
  if (!id.startsWith(`${sentinel}:`)) return null;
  return asId(id.slice(sentinel.length + 1));
}

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

export interface ScopeGroup<T> {
  scope: PmScope;
  /** `scopeKey(scope)` — stable, prefixed, safe as a Map key. */
  key: string;
  /** Convenience mirrors so older readers migrate mechanically. */
  scopePropertyId: string | null;
  scopeCompanyId: string | null;
  items: T[];
}

/**
 * Group items by their scope, preserving first-seen order.
 *
 * Replaces `groupAmountsByScope` in lib/pm/recurringPoster.ts, whose return
 * type was the lossy `{ scopePropertyId: ObjectId | null }` — it discarded a
 * Company row's id entirely, which is why two named companies on one rule used
 * to collapse into a single group and lose one company's money to a swallowed
 * duplicate-key error.
 */
export function groupByScope<T>(
  items: T[],
  read: (item: T) => ScopeLike,
): ScopeGroup<T>[] {
  const groups = new Map<string, ScopeGroup<T>>();
  for (const item of items) {
    const scope = normalizeScope(read(item));
    const key = scopeKey(scope);
    let group = groups.get(key);
    if (!group) {
      group = {
        scope,
        key,
        scopePropertyId: scopePropertyIdOf(scope),
        scopeCompanyId: scopeCompanyIdOf(scope),
        items: [],
      };
      groups.set(key, group);
    }
    group.items.push(item);
  }
  return Array.from(groups.values());
}
