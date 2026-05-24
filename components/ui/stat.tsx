// Stat card from the Lattice design — white surface, 8px radius, hairline
// border, 11.5px muted label / 22px semibold tabular value / 11.5px subtitle
// (the subtitle can be tinted positive/negative via the `tone` prop).
import * as React from "react";
import { cn } from "@/lib/utils/cn";

type Tone = "default" | "pos" | "neg";

export interface StatProps {
  label: React.ReactNode;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: Tone;
  icon?: React.ReactNode;
  className?: string;
}

const SUB_TONE: Record<Tone, string> = {
  default: "text-fg-muted",
  pos: "text-gain",
  neg: "text-loss",
};

export function Stat({
  label,
  value,
  sub,
  tone = "default",
  icon,
  className,
}: StatProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-[6px] rounded-lg border border-border bg-surface px-4 py-[14px]",
        className,
      )}
    >
      <div className="flex items-center gap-[6px] text-[11.5px] font-medium text-fg-muted">
        {icon}
        <span>{label}</span>
      </div>
      <div className="text-[22px] font-[650] leading-[1.1] tracking-[-0.018em] text-fg tabular-nums">
        {value}
      </div>
      {sub && (
        <div
          className={cn(
            "flex items-center gap-[5px] text-[11.5px]",
            SUB_TONE[tone],
          )}
        >
          {sub}
        </div>
      )}
    </div>
  );
}

export default Stat;
