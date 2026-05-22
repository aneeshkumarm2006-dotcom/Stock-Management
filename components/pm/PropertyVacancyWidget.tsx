// Property vacancy chart sidebar widget (Phase 3 — unblocks PROPERTY_TODO.md
// line 243). Aggregates Unit.count(propertyId) vs Lease.distinct(unitId,
// status in (Active, Future)) and renders a tiny donut + the totals.
"use client";

import * as React from "react";

interface PropertyVacancyWidgetProps {
  propertyId: string;
}

interface UnitLite {
  id: string;
}
interface LeaseLite {
  unitId: string;
  status: string;
}

export function PropertyVacancyWidget({
  propertyId,
}: PropertyVacancyWidgetProps) {
  const [unitCount, setUnitCount] = React.useState<number | null>(null);
  const [occupiedCount, setOccupiedCount] = React.useState<number | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch(`/api/pm/units?propertyId=${propertyId}`).then((r) =>
        r.ok ? r.json() : [],
      ),
      fetch(`/api/pm/leases?propertyId=${propertyId}&status=Active,Future`).then(
        (r) => (r.ok ? r.json() : []),
      ),
    ]).then(([u, l]) => {
      if (cancelled) return;
      const units = u as UnitLite[];
      const leases = l as LeaseLite[];
      setUnitCount(units.length);
      setOccupiedCount(new Set(leases.map((row) => row.unitId)).size);
    });
    return () => {
      cancelled = true;
    };
  }, [propertyId]);

  if (unitCount == null || occupiedCount == null) {
    return <div className="text-xs text-fg-muted">Loading…</div>;
  }
  const vacant = Math.max(0, unitCount - occupiedCount);
  const pctOccupied =
    unitCount === 0 ? 0 : Math.round((occupiedCount / unitCount) * 100);

  // SVG donut: stroke-dasharray drives the filled arc length.
  const radius = 28;
  const circumference = 2 * Math.PI * radius;
  const filled = (pctOccupied / 100) * circumference;

  return (
    <div className="flex items-center gap-4">
      <svg width={72} height={72} viewBox="0 0 72 72">
        <circle
          cx="36"
          cy="36"
          r={radius}
          fill="none"
          stroke="rgb(var(--surface-high))"
          strokeWidth="8"
        />
        <circle
          cx="36"
          cy="36"
          r={radius}
          fill="none"
          stroke="rgb(var(--primary))"
          strokeWidth="8"
          strokeDasharray={`${filled} ${circumference}`}
          strokeLinecap="round"
          transform="rotate(-90 36 36)"
        />
        <text
          x="36"
          y="40"
          textAnchor="middle"
          fontSize="14"
          fill="currentColor"
          fontWeight="600"
        >
          {pctOccupied}%
        </text>
      </svg>
      <div className="text-sm">
        <div>
          <span className="font-medium">{occupiedCount}</span>
          <span className="text-fg-muted"> occupied</span>
        </div>
        <div>
          <span className="font-medium">{vacant}</span>
          <span className="text-fg-muted"> vacant</span>
        </div>
        <div className="text-xs text-fg-muted">
          of {unitCount} unit{unitCount === 1 ? "" : "s"}
        </div>
      </div>
    </div>
  );
}
