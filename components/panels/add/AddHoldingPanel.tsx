"use client";

// Type-aware Add-holding panel. Replaces the old AddPositionPanel: it owns the
// open/close UI state and the selected asset type, then mounts exactly one
// type-specific sub-form. Switching type remounts the sub-form so its react-
// hook-form state resets cleanly. Each sub-form renders its own SidePanel via
// AddHoldingShell.
import { useEffect, useState } from "react";
import { useUiStore } from "@/store/useUiStore";
import { useToast } from "@/components/ui/toast";
import type { AssetType } from "@/lib/hooks/useDashboard";
import { AddEquityForm } from "./AddEquityForm";
import { AddFixedIncomeForm } from "./AddFixedIncomeForm";
import { AddManualValueForm } from "./AddManualValueForm";

export function AddHoldingPanel() {
  const open = useUiStore((s) => s.addPanelOpen);
  const close = useUiStore((s) => s.closeAddPanel);
  const isOffline = useUiStore((s) => s.isOffline);
  const { toast } = useToast();
  const [assetType, setAssetType] = useState<AssetType>("EQUITY");

  // Reset to the default type each time the panel is reopened.
  useEffect(() => {
    if (open) setAssetType("EQUITY");
  }, [open]);

  function guardedClose() {
    close();
  }

  function changeType(t: AssetType) {
    if (isOffline) {
      toast({
        title: "You're offline",
        description: "Reconnect to add a holding.",
        variant: "error",
      });
    }
    setAssetType(t);
  }

  const shared = {
    open,
    onClose: guardedClose,
    assetType,
    onTypeChange: changeType,
  };

  // One sub-form mounted at a time, keyed by type so state resets on switch.
  switch (assetType) {
    case "GIC":
    case "BOND":
      return <AddFixedIncomeForm key={assetType} {...shared} />;
    case "MUTUAL_FUND":
    case "CASH":
      return <AddManualValueForm key={assetType} {...shared} />;
    case "EQUITY":
    default:
      return <AddEquityForm key="EQUITY" {...shared} />;
  }
}
