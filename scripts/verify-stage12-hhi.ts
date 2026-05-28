// Stage 12 DoD: verify the normalized-HHI concentration score on known
// sample portfolios. Run: npx --yes tsx scripts/verify-stage12-hhi.ts
import {
  concentrationScore,
  computePortfolio,
  type PositionInput,
} from "../lib/utils/portfolioMath";

let failures = 0;
function expect(name: string, got: number, want: number, tol = 0.5) {
  const ok = Math.abs(got - want) <= tol;
  if (!ok) failures++;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${name}: got ${got.toFixed(3)}, want ~${want}`,
  );
}

// --- Direct HHI on known weight vectors -----------------------------------
expect("empty", concentrationScore([]), 0);
expect("single holding (n=1 ⇒ 100)", concentrationScore([1]), 100);
expect("2 equal (0.5/0.5)", concentrationScore([0.5, 0.5]), 0);
expect("4 equal (0.25 each)", concentrationScore([0.25, 0.25, 0.25, 0.25]), 0);
// 2 holdings 0.9/0.1: HHI=0.82, min=0.5 ⇒ (0.82-0.5)/0.5 = 0.64 ⇒ 64
expect("2 skewed (0.9/0.1)", concentrationScore([0.9, 0.1]), 64);
// 3 holdings 0.6/0.3/0.1: HHI=0.46, min=1/3 ⇒ (0.46-0.3333)/0.6667 ≈ 0.19 ⇒ 19
expect("3 skewed (0.6/0.3/0.1)", concentrationScore([0.6, 0.3, 0.1]), 19);

// --- End-to-end through computePortfolio (equal-value sample) -------------
// 4 positions, each worth 100 USD at quote ⇒ equal weights ⇒ score 0,
// topWeightPct 25, uniqueSectors 4.
const sample: PositionInput[] = [
  { id: "1", ticker: "A", exchange: "NASDAQ", quantity: 10, avgBuyPrice: 10, currency: "USD", sector: "Tech", country: "US", price: 10 },
  { id: "2", ticker: "B", exchange: "NYSE", quantity: 10, avgBuyPrice: 10, currency: "USD", sector: "Energy", country: "US", price: 10 },
  { id: "3", ticker: "C", exchange: "TSX", quantity: 10, avgBuyPrice: 10, currency: "CAD", sector: "Financials", country: "CA", price: 10 },
  { id: "4", ticker: "D", exchange: "NASDAQ", quantity: 10, avgBuyPrice: 10, currency: "USD", sector: "Health", country: "US", price: 10 },
];
// Note: C is CAD → after FX its USD value (~74.07) is < the 3 USD positions
// (100 each), so weights are NOT equal — this verifies the math is FX-aware
// (PDR §9): weights ≈ 26.73/26.73/19.80/26.73, HHI ≈ 0.2536,
// normalized (0.2536-0.25)/0.75 ≈ 0.48; top weight ≈ 26.73%.
const s = computePortfolio(sample, {
  displayCurrency: "USD",
  rates: { USD: 1, CAD: 1.35 },
});
expect("e2e concentration (FX-weighted)", s.diversification.concentrationScore, 0.48, 0.05);
expect("e2e topWeightPct (FX-weighted)", s.diversification.topWeightPct, 26.73, 0.1);
expect("e2e uniqueSectors", s.diversification.uniqueSectors, 4, 0);
// Currency exposure: C is CAD (10*10 CAD → /1.35 ≈ 74.07 USD), 3 are USD
// (100 USD each = 300). Pct CAD ≈ 74.07 / 374.07 ≈ 19.8%.
const cad = s.allocationByCurrency.find((a) => a.key === "CAD");
const usd = s.allocationByCurrency.find((a) => a.key === "USD");
expect("currency exposure CAD %", cad?.pct ?? -1, 19.8, 0.5);
expect("currency exposure USD %", usd?.pct ?? -1, 80.2, 0.5);
// Country exposure: 1 of 4 is CA but values differ after FX → CA by value.
const ca = s.allocationByCountry.find((a) => a.key === "CA");
expect("country exposure CA %", ca?.pct ?? -1, 19.8, 0.5);

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
