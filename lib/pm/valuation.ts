// Income-capitalization property valuation (Area 2).
//
// Market Value = Net Operating Income / capitalization rate, where
// NOI = annual income − annual expenses. Income and expenses default to the
// property's live General Ledger figures (from /api/pm/financials/matrix) but
// each can be overridden on the Property so the user can model a value.
//
// Money here is in DOLLARS (matching Property.propertyReserve and the stored
// valuation overrides). The matrix returns cents, so convert with fromCents
// before feeding `glIncome`/`glExpense` in. Kept in one module so the detail
// card and the properties-list column compute identically.

export interface MatrixLike {
  accounts: Array<{ id: string; type: string }>;
  cells: Array<{ accountId: string; propertyId: string; amount: number }>;
}

/**
 * Reduce a financials-matrix payload into per-property GL income/expense in
 * CENTS (the matrix's native unit). Income cells are stored positive and
 * Operating-Expense cells are already sign-flipped positive, so we sum each
 * bucket directly. Property id "company" and archived-property ids pass through
 * as their own keys — callers filter to the property they care about.
 */
export function glIncomeExpenseCentsByProperty(
  matrix: MatrixLike,
): Map<string, { incomeCents: number; expenseCents: number }> {
  const typeById = new Map(matrix.accounts.map((a) => [a.id, a.type]));
  const out = new Map<string, { incomeCents: number; expenseCents: number }>();
  for (const c of matrix.cells) {
    const t = typeById.get(c.accountId);
    if (t !== "Income" && t !== "Operating Expense") continue;
    const cur = out.get(c.propertyId) ?? { incomeCents: 0, expenseCents: 0 };
    if (t === "Income") cur.incomeCents += c.amount;
    else cur.expenseCents += c.amount;
    out.set(c.propertyId, cur);
  }
  return out;
}

export interface MarketValueInput {
  /** Typed override in dollars, or null to use the ledger figure. */
  incomeOverride: number | null;
  expenseOverride: number | null;
  /** Cap rate as a percent (e.g. 6.5 = 6.5%), or null when unset. */
  capRatePct: number | null;
  /** Live ledger income/expense in DOLLARS (already fromCents'd). */
  glIncome: number;
  glExpense: number;
}

export interface MarketValueResult {
  /** Effective annual income used (override ?? ledger), dollars. */
  income: number;
  expense: number;
  noi: number;
  /** null when no positive cap rate is set (can't divide). */
  marketValue: number | null;
}

export function computeMarketValue(input: MarketValueInput): MarketValueResult {
  const income = input.incomeOverride ?? input.glIncome;
  const expense = input.expenseOverride ?? input.glExpense;
  const noi = income - expense;
  const marketValue =
    input.capRatePct && input.capRatePct > 0
      ? noi / (input.capRatePct / 100)
      : null;
  return { income, expense, noi, marketValue };
}

/**
 * Trailing-12-month `from`/`to` (YYYY-MM-DD) for the valuation's GL window, so
 * income/expense annualize to a full year. Client-only (uses `new Date`).
 */
export function trailing12moRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to);
  from.setFullYear(from.getFullYear() - 1);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}
