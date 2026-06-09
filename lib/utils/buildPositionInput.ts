// Maps an ApiPosition (+ its live quote, equities only) to the PositionInput
// that computePortfolio consumes. Equities pass through their quote; every
// other asset type is valued natively via valuateHolding and fed as a "manual"
// holding (quantity 1, avgBuyPrice = invested, price = current value) so the
// existing display-currency math produces correct totals/weights without a
// branch in portfolioMath. Refs: plan §4.
import type { PositionInput, Country } from "./portfolioMath";
import { valuateHolding } from "./assetValuation";
import type { ApiPosition } from "@/lib/hooks/useDashboard";

interface QuoteLite {
  price: number;
  dayChange: number;
}

/** Synthetic sector/country buckets so non-equity holdings read sensibly in
 *  the allocation donuts instead of all collapsing into "Unknown". */
const SECTOR_BY_TYPE: Record<string, string> = {
  GIC: "Fixed income",
  BOND: "Fixed income",
  MUTUAL_FUND: "Mutual funds",
  CASH: "Cash & other",
};

export function toPositionInput(
  p: ApiPosition,
  quote: QuoteLite | undefined,
): PositionInput {
  if ((p.assetType ?? "EQUITY") === "EQUITY") {
    return {
      id: p.id,
      ticker: p.ticker ?? "",
      exchange: p.exchange ?? "",
      quantity: p.quantity ?? 0,
      avgBuyPrice: p.avgBuyPrice ?? 0,
      currency: p.currency,
      sector: p.metadata?.sector ?? null,
      country: p.metadata?.country ?? null,
      price: quote?.price ?? null,
      dayChange: quote?.dayChange ?? null,
    };
  }

  const v = valuateHolding({
    assetType: p.assetType,
    currency: p.currency,
    principal: p.principal,
    interestRate: p.interestRate,
    payoutFrequency: p.payoutFrequency,
    startDate: p.startDate,
    maturityDate: p.maturityDate,
    costBasis: p.costBasis,
    currentValue: p.currentValue,
  });

  return {
    id: p.id,
    ticker: p.label ?? p.assetType,
    exchange: p.assetType,
    quantity: 1,
    avgBuyPrice: v.invested,
    currency: p.currency,
    sector: SECTOR_BY_TYPE[p.assetType] ?? null,
    country: (p.metadata?.country as Country | undefined) ?? null,
    price: v.currentValue,
    dayChange: null,
    manual: true,
  };
}
