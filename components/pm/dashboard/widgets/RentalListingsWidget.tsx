"use client";

// Rental Listings 2x2 donut — Dashboard (PROPERTY_TODO.md Phase 10). Center
// shows total units; four wedges = occupancy × listed visibility, served by
// /api/pm/rentals-summary.
import * as React from "react";
import { WidgetCard } from "../WidgetCard";

interface Payload {
  units: {
    total: number;
    vacantUnlisted: number;
    vacantListed: number;
    occupiedUnlisted: number;
    occupiedListed: number;
  };
}

const SLICE_COLORS = {
  vacantUnlisted: "rgb(var(--fg-muted))",
  vacantListed: "rgb(var(--tertiary))",
  occupiedUnlisted: "rgb(var(--primary))",
  occupiedListed: "rgb(var(--gain))",
};

interface ArcInput {
  value: number;
  color: string;
}

function Donut({ arcs, total }: { arcs: ArcInput[]; total: number }) {
  const radius = 32;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  return (
    <svg width={120} height={120} viewBox="0 0 120 120" role="img" aria-label="Rental listings breakdown">
      <circle
        cx={60}
        cy={60}
        r={radius}
        fill="none"
        stroke="rgb(var(--surface-high))"
        strokeWidth={12}
      />
      {total > 0 &&
        arcs.map((a, i) => {
          const length = (a.value / total) * circumference;
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
        {total}
      </text>
      <text
        x={60}
        y={74}
        textAnchor="middle"
        fontSize={9}
        fill="rgb(var(--fg-muted))"
      >
        Total units
      </text>
    </svg>
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

export function RentalListingsWidget() {
  const [data, setData] = React.useState<Payload | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    fetch("/api/pm/rentals-summary")
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

  const u = data?.units;
  const total = u?.total ?? 0;
  const arcs: ArcInput[] = u
    ? [
        { value: u.vacantUnlisted, color: SLICE_COLORS.vacantUnlisted },
        { value: u.vacantListed, color: SLICE_COLORS.vacantListed },
        { value: u.occupiedUnlisted, color: SLICE_COLORS.occupiedUnlisted },
        { value: u.occupiedListed, color: SLICE_COLORS.occupiedListed },
      ]
    : [];

  return (
    <WidgetCard title="Rental Listings" viewAllHref="/properties/leasing/listings">
      {total === 0 ? (
        <p className="text-sm text-fg-muted">No units.</p>
      ) : (
        <div className="flex flex-1 items-center gap-4">
          <Donut arcs={arcs} total={total} />
          <ul className="flex-1 space-y-1 text-xs">
            <Legend
              color={SLICE_COLORS.vacantUnlisted}
              label="Vacant / unlisted"
              value={u?.vacantUnlisted ?? 0}
            />
            <Legend
              color={SLICE_COLORS.vacantListed}
              label="Vacant / listed"
              value={u?.vacantListed ?? 0}
            />
            <Legend
              color={SLICE_COLORS.occupiedUnlisted}
              label="Occupied / unlisted"
              value={u?.occupiedUnlisted ?? 0}
            />
            <Legend
              color={SLICE_COLORS.occupiedListed}
              label="Occupied / listed"
              value={u?.occupiedListed ?? 0}
            />
          </ul>
        </div>
      )}
    </WidgetCard>
  );
}

export default RentalListingsWidget;
