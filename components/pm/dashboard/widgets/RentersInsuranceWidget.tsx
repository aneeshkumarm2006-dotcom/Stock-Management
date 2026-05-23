"use client";

// Renters Insurance donut — Dashboard (PROPERTY_TODO.md Phase 10). Three
// slices: MSI / Third Party / Uninsured. Powered by the org-wide rollup at
// /api/pm/renters-insurance. SVG stroke-dasharray pattern lifted from
// PropertyVacancyWidget; no chart library required.
import * as React from "react";
import { WidgetCard } from "../WidgetCard";

interface Payload {
  counts: { msi: number; thirdParty: number; uninsured: number; total: number };
}

const COLORS = {
  msi: "rgb(var(--primary))",
  thirdParty: "rgb(var(--tertiary))",
  uninsured: "rgb(var(--error))",
};

interface ArcInput {
  value: number;
  color: string;
}

function Donut({
  arcs,
  totalForDenominator,
  centerLabel,
  centerSub,
}: {
  arcs: ArcInput[];
  totalForDenominator: number;
  centerLabel: string | number;
  centerSub: string;
}) {
  const radius = 32;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  return (
    <svg width={120} height={120} viewBox="0 0 120 120" role="img" aria-label="Renters insurance breakdown">
      <circle
        cx={60}
        cy={60}
        r={radius}
        fill="none"
        stroke="rgb(var(--surface-high))"
        strokeWidth={12}
      />
      {totalForDenominator > 0 &&
        arcs.map((a, i) => {
          const length = (a.value / totalForDenominator) * circumference;
          const dashArray = `${length} ${circumference - length}`;
          const dashOffset = -offset;
          offset += length;
          return (
            <circle
              key={i}
              cx={60}
              cy={60}
              r={radius}
              fill="none"
              stroke={a.color}
              strokeWidth={12}
              strokeDasharray={dashArray}
              strokeDashoffset={dashOffset}
              transform="rotate(-90 60 60)"
            />
          );
        })}
      <text
        x={60}
        y={58}
        textAnchor="middle"
        fontSize={18}
        fontWeight={700}
        fill="currentColor"
      >
        {centerLabel}
      </text>
      <text
        x={60}
        y={74}
        textAnchor="middle"
        fontSize={9}
        fill="rgb(var(--fg-muted))"
      >
        {centerSub}
      </text>
    </svg>
  );
}

export function RentersInsuranceWidget() {
  const [data, setData] = React.useState<Payload | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    fetch("/api/pm/renters-insurance")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d) setData(d as Payload);
      })
      .catch(() => {
        /* swallow */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const counts = data?.counts;
  const total = counts?.total ?? 0;
  const arcs: ArcInput[] = counts
    ? [
        { value: counts.msi, color: COLORS.msi },
        { value: counts.thirdParty, color: COLORS.thirdParty },
        { value: counts.uninsured, color: COLORS.uninsured },
      ]
    : [];

  return (
    <WidgetCard
      title="Renters Insurance"
      viewAllHref="/properties/rentals/rent-roll"
    >
      {total === 0 ? (
        <p className="text-sm text-fg-muted">No active leases.</p>
      ) : (
        <div className="flex flex-1 items-center gap-4">
          <Donut
            arcs={arcs}
            totalForDenominator={total}
            centerLabel={total}
            centerSub="Total"
          />
          <ul className="flex-1 space-y-1 text-xs">
            <Legend color={COLORS.msi} label="MSI policy" value={counts?.msi ?? 0} />
            <Legend
              color={COLORS.thirdParty}
              label="Third Party"
              value={counts?.thirdParty ?? 0}
            />
            <Legend
              color={COLORS.uninsured}
              label="Not insured"
              value={counts?.uninsured ?? 0}
            />
          </ul>
        </div>
      )}
    </WidgetCard>
  );
}

function Legend({
  color,
  label,
  value,
}: {
  color: string;
  label: string;
  value: number;
}) {
  return (
    <li className="flex items-center justify-between gap-2">
      <span className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className="inline-block h-2.5 w-2.5 rounded-sm"
          style={{ backgroundColor: color }}
        />
        <span className="text-fg-muted">{label}</span>
      </span>
      <span className="font-semibold tabular-nums text-fg">{value}</span>
    </li>
  );
}

export default RentersInsuranceWidget;
