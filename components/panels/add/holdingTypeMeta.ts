// Shared labels for the asset-type selector + per-type panel copy.
import type { AssetType } from "@/lib/hooks/useDashboard";

export const ADD_TYPE_ORDER: AssetType[] = [
  "EQUITY",
  "GIC",
  "BOND",
  "MUTUAL_FUND",
  "CASH",
];

export const TYPE_LABEL: Record<AssetType, string> = {
  EQUITY: "Stock / ETF",
  GIC: "GIC",
  BOND: "Bond",
  MUTUAL_FUND: "Mutual fund",
  CASH: "Cash / Other",
};

export const TYPE_SHORT: Record<AssetType, string> = {
  EQUITY: "Stock/ETF",
  GIC: "GIC",
  BOND: "Bond",
  MUTUAL_FUND: "Fund",
  CASH: "Cash",
};
