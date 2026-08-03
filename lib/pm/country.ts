// Shared US/Canada country bucketing for Property Management surfaces.
//
// A property's `address.country` is a free-text field that in practice holds
// ISO-ish codes ("US"/"CA") but may carry common spellings ("USA", "Canada")
// or be blank. Several features need to group rows (leases, properties,
// outstanding balances) by country into stable, human-readable buckets — this
// module is the single source of truth so every surface buckets identically.
//
// Originally `normalizeCountry` lived privately in the dashboard's
// outstanding-balances aggregator; it was lifted here when the rent roll and
// properties list needed the same US/CAN separation.

export const OTHER = "Other";

// Normalize the free-text `address.country` into a stable display bucket. The
// data uses ISO-ish codes ("US"/"CA") but we accept common spellings too.
// Unknown-but-present values pass through verbatim (so an org operating in a
// third country still gets its own named group); blank falls back to `Other`.
export function normalizeCountry(raw: string | undefined | null): string {
  const c = (raw ?? "").trim().toUpperCase();
  if (["US", "USA", "U.S.", "U.S.A.", "UNITED STATES"].includes(c)) {
    return "United States";
  }
  if (["CA", "CAN", "CANADA"].includes(c)) return "Canada";
  return raw && raw.trim() ? raw.trim() : OTHER;
}

// Display order for country group labels: `Other` always sorts last; the two
// primary markets (United States, then Canada) lead; any other named country
// falls between them, alphabetically. Use this when ordering sections/groups
// by label. (Callers ordering by a numeric total — e.g. the outstanding
// balances widget — keep their value-based sort and only borrow the
// `Other`-last rule.)
const COUNTRY_PRIORITY: Record<string, number> = {
  "United States": 0,
  Canada: 1,
};

export function compareCountryGroups(a: string, b: string): number {
  if (a === b) return 0;
  if (a === OTHER) return 1;
  if (b === OTHER) return -1;
  const pa = COUNTRY_PRIORITY[a] ?? 2;
  const pb = COUNTRY_PRIORITY[b] ?? 2;
  if (pa !== pb) return pa - pb;
  return a.localeCompare(b);
}
