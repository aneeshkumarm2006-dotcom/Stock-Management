"use client";

// Shared chrome for every Add-holding sub-form: the SidePanel, the asset-type
// selector at the top of the body, and the Cancel / submit footer. Each
// sub-form supplies its own <form id={formId}> as children and drives the
// submit button's pending state. Keeps the per-type forms focused on fields.
import * as React from "react";
import { Loader2, Plus } from "lucide-react";
import type { AssetType } from "@/lib/hooks/useDashboard";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";
import { SidePanel } from "../SidePanel";
import { ADD_TYPE_ORDER, TYPE_SHORT } from "./holdingTypeMeta";

function TypeSelector({
  value,
  onChange,
}: {
  value: AssetType;
  onChange: (t: AssetType) => void;
}) {
  return (
    <div>
      <p className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-fg-muted">
        Holding type
      </p>
      <div className="grid grid-cols-5 gap-1 rounded-md border border-border bg-surface-highest p-1">
        {ADD_TYPE_ORDER.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => onChange(t)}
            className={cn(
              "rounded px-1.5 py-2 text-[11px] font-bold tracking-wide transition-colors",
              value === t
                ? "bg-primary text-primary-fg"
                : "text-fg-muted hover:text-fg",
            )}
          >
            {TYPE_SHORT[t]}
          </button>
        ))}
      </div>
    </div>
  );
}

export function AddHoldingShell({
  open,
  onClose,
  assetType,
  onTypeChange,
  title,
  description,
  formId,
  submitLabel,
  submitting,
  disabled,
  children,
}: {
  open: boolean;
  onClose: () => void;
  assetType: AssetType;
  onTypeChange: (t: AssetType) => void;
  title: string;
  description?: string;
  formId: string;
  submitLabel: string;
  submitting: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <SidePanel
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      footer={
        <div className="flex items-center justify-end gap-3">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={formId} disabled={submitting || disabled}>
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Adding…
              </>
            ) : (
              <>
                <Plus className="h-4 w-4" />
                {submitLabel}
              </>
            )}
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        <TypeSelector value={assetType} onChange={onTypeChange} />
        {children}
      </div>
    </SidePanel>
  );
}
