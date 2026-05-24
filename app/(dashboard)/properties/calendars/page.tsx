// /properties/calendars — Phase 7 community calendar grid (PDR_MASTER
// §3.34, §4.6, §8 Phase 7). PROPERTY_TODO calls this `/manager/app/
// community-calendar`; this codebase mounts it under `/properties/`
// to match the existing nav.ts convention.
//
// Surface:
//   - View switcher: Day / Week / Month.
//   - Property overlay multi-picker (BR-CC-7 max 15).
//   - Click empty slot → opens CalendarEventModal pre-filled (drag-to-
//     create [G-B-14] — full pointer drag is a follow-up, but the
//     click-to-create shortcut covers the core flow today).
//   - Drag an event → PATCH with new startDate (drag-to-reschedule
//     [G-B-14]; instance-vs-series choice is offered for recurring
//     events).
//   - Export ICS via Download .ics button ([G-B-15]).
"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus, Download, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { PageHead } from "@/components/layout/PageHead";
import {
  CalendarEventModal,
  type CalendarEventInitial,
  type CalendarEventModalPropertyOption,
} from "@/components/pm/CalendarEventModal";
import {
  CALENDAR_MAX_OVERLAYS,
  type CalendarView,
  type CalendarRepeat,
  type CalendarReminder,
} from "@/types/pm";

interface EventRow {
  id: string;
  occurrenceId: string;
  isMaster: boolean;
  propertyId: string;
  eventName: string;
  description: string;
  startDate: string;
  endDate: string;
  allDay: boolean;
  timezone: string;
  repeat: CalendarRepeat;
  location: string;
  reminder: CalendarReminder;
  linkedWorkOrderId: string | null;
  recurrenceParentId: string | null;
  attachments: string[];
}

interface PropertyOption {
  id: string;
  propertyName: string;
}

interface OrgInfo {
  timezone: string;
}

const PROPERTY_PALETTE = [
  "#2563eb",
  "#16a34a",
  "#db2777",
  "#ea580c",
  "#9333ea",
  "#0891b2",
  "#ca8a04",
  "#dc2626",
  "#0ea5e9",
  "#65a30d",
  "#7c3aed",
  "#be185d",
  "#0d9488",
  "#a16207",
  "#475569",
];

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}
function startOfWeek(d: Date): Date {
  const out = startOfDay(d);
  out.setDate(out.getDate() - out.getDay());
  return out;
}
function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function windowFor(view: CalendarView, anchor: Date): { from: Date; to: Date } {
  switch (view) {
    case "day":
      return { from: startOfDay(anchor), to: new Date(startOfDay(anchor).getTime() + DAY_MS - 1) };
    case "week": {
      const from = startOfWeek(anchor);
      return { from, to: new Date(from.getTime() + 7 * DAY_MS - 1) };
    }
    case "month":
    default: {
      const from = startOfMonth(anchor);
      // Render six weeks so leading + trailing days from neighbor months
      // fill out the grid.
      const gridStart = startOfWeek(from);
      const gridEnd = new Date(gridStart.getTime() + 42 * DAY_MS - 1);
      return { from: gridStart, to: gridEnd };
    }
  }
}

function fmtMonth(d: Date) {
  return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}
function fmtDay(d: Date) {
  return d.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}
function sameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export default function CalendarsPage() {
  return (
    <React.Suspense fallback={null}>
      <CalendarsPageInner />
    </React.Suspense>
  );
}

function CalendarsPageInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { toast } = useToast();

  const initialView =
    (params.get("view") as CalendarView | null) ?? "month";
  const [view, setView] = React.useState<CalendarView>(initialView);
  const [anchor, setAnchor] = React.useState<Date>(() => new Date());

  const [orgInfo, setOrgInfo] = React.useState<OrgInfo>({
    timezone: "America/New_York",
  });
  const [properties, setProperties] = React.useState<PropertyOption[]>([]);
  const [selectedPropertyIds, setSelectedPropertyIds] = React.useState<
    string[]
  >([]);
  const [rows, setRows] = React.useState<EventRow[]>([]);
  const [loading, setLoading] = React.useState(true);

  const [modalOpen, setModalOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<CalendarEventInitial | null>(
    null,
  );
  const [createPreset, setCreatePreset] = React.useState<{
    propertyId?: string;
    start?: Date;
    end?: Date;
  }>({});

  const propertyColor = React.useMemo(() => {
    const map = new Map<string, string>();
    properties.forEach((p, idx) => {
      const c =
        PROPERTY_PALETTE[idx % PROPERTY_PALETTE.length] ?? "#94a3b8";
      map.set(p.id, c);
    });
    return map;
  }, [properties]);

  // Load org timezone + property list once.
  React.useEffect(() => {
    void (async () => {
      const [orgRes, propRes] = await Promise.all([
        fetch("/api/pm/organization").catch(() => null),
        fetch("/api/pm/properties").catch(() => null),
      ]);
      if (orgRes?.ok) {
        const o = (await orgRes.json()) as { timezone?: string };
        if (o.timezone) setOrgInfo({ timezone: o.timezone });
      }
      if (propRes?.ok) {
        const list = (await propRes.json()) as Array<{
          id: string;
          propertyName: string;
        }>;
        setProperties(list.map((p) => ({ id: p.id, propertyName: p.propertyName })));
        // Default overlay = first 15 properties (mirrors BR-CC-7 cap).
        setSelectedPropertyIds(
          list.slice(0, CALENDAR_MAX_OVERLAYS).map((p) => p.id),
        );
      }
    })();
  }, []);

  const viewWindow = React.useMemo(
    () => windowFor(view, anchor),
    [view, anchor],
  );

  const load = React.useCallback(async () => {
    setLoading(true);
    const qs = new URLSearchParams();
    qs.set("from", viewWindow.from.toISOString());
    qs.set("to", viewWindow.to.toISOString());
    if (selectedPropertyIds.length > 0) {
      qs.set("propertyIds", selectedPropertyIds.join(","));
    }
    const r = await fetch(`/api/pm/calendar-events?${qs.toString()}`);
    if (r.ok) {
      const data = (await r.json()) as EventRow[];
      setRows(data);
    } else {
      const err = (await r.json().catch(() => ({}))) as { error?: string };
      toast({
        title: "Failed to load events",
        description: err.error,
        variant: "error",
      });
    }
    setLoading(false);
  }, [viewWindow.from, viewWindow.to, selectedPropertyIds, toast]);

  React.useEffect(() => {
    void load();
  }, [load]);

  React.useEffect(() => {
    const next = new URLSearchParams(params.toString());
    next.set("view", view);
    router.replace(`/properties/calendars?${next.toString()}`);
  }, [view, params, router]);

  // Notification deep-link: dispatchCalendarReminders writes
  // `/properties/calendars?event=<masterId>` into each Notification.link.
  // When the user clicks the bell badge we fetch the master event and
  // open the modal in edit mode. Master-row precision matches Buildium
  // parity (no per-occurrence deep-link).
  const deepLinkRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    const eventId = params.get("event");
    if (!eventId || deepLinkRef.current === eventId) return;
    deepLinkRef.current = eventId;
    void (async () => {
      const r = await fetch(`/api/pm/calendar-events/${eventId}`);
      if (!r.ok) return;
      const d = (await r.json()) as CalendarEventInitial & {
        attachments?: string[];
      };
      setEditing({
        id: d.id,
        propertyId: d.propertyId,
        eventName: d.eventName,
        description: d.description,
        startDate: d.startDate,
        endDate: d.endDate,
        allDay: d.allDay,
        repeat: d.repeat,
        reminder: d.reminder,
        location: d.location,
        recurrenceParentId: d.recurrenceParentId,
        timezone: d.timezone,
        attachments: d.attachments ?? [],
      });
      setModalOpen(true);
    })();
  }, [params]);

  function shift(direction: 1 | -1) {
    const next = new Date(anchor);
    if (view === "day") next.setDate(next.getDate() + direction);
    if (view === "week") next.setDate(next.getDate() + 7 * direction);
    if (view === "month") next.setMonth(next.getMonth() + direction);
    setAnchor(next);
  }

  function togglePropertyOverlay(id: string) {
    setSelectedPropertyIds((prev) => {
      if (prev.includes(id)) return prev.filter((p) => p !== id);
      if (prev.length >= CALENDAR_MAX_OVERLAYS) {
        toast({
          title: `Maximum ${CALENDAR_MAX_OVERLAYS} property overlays (BR-CC-7)`,
          variant: "error",
        });
        return prev;
      }
      return [...prev, id];
    });
  }

  function openCreateAt(day: Date) {
    // Click-to-create — pre-fill 9am for non-day view, or the day's
    // current time for day view.
    const start = new Date(day);
    if (view === "day") {
      // already specific
    } else {
      start.setHours(9, 0, 0, 0);
    }
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    setEditing(null);
    setCreatePreset({
      propertyId: selectedPropertyIds[0] ?? properties[0]?.id,
      start,
      end,
    });
    setModalOpen(true);
  }

  function openEdit(ev: EventRow) {
    setEditing({
      id: ev.id,
      propertyId: ev.propertyId,
      eventName: ev.eventName,
      description: ev.description,
      startDate: ev.startDate,
      endDate: ev.endDate,
      allDay: ev.allDay,
      repeat: ev.repeat,
      reminder: ev.reminder,
      location: ev.location,
      recurrenceParentId: ev.recurrenceParentId,
      timezone: ev.timezone,
      attachments: ev.attachments ?? [],
    });
    setCreatePreset({});
    setModalOpen(true);
  }

  async function rescheduleEvent(ev: EventRow, newStart: Date) {
    // BR-CC-11 default — preserve duration.
    const duration =
      new Date(ev.endDate).getTime() - new Date(ev.startDate).getTime();
    const newEnd = new Date(newStart.getTime() + duration);
    let editScope: "instance" | "series" = "series";
    if (ev.repeat !== "Does not repeat") {
      // Ask the user when a recurring event is dragged ([G-B-13]).
      const pickInstance = window.confirm(
        "This is a recurring event. OK = move this instance only; Cancel = move the entire series.",
      );
      editScope = pickInstance ? "instance" : "series";
    }
    const res = await fetch(`/api/pm/calendar-events/${ev.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        startDate: newStart.toISOString(),
        endDate: newEnd.toISOString(),
        editScope,
      }),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      toast({
        title: "Failed to reschedule",
        description: err.error,
        variant: "error",
      });
      return;
    }
    toast({ title: "Event rescheduled", variant: "success" });
    await load();
  }

  async function exportIcs() {
    const qs = new URLSearchParams();
    if (selectedPropertyIds.length > 0) {
      qs.set("propertyIds", selectedPropertyIds.join(","));
    }
    window.open(`/api/pm/calendar-events/ics?${qs.toString()}`, "_blank");
  }

  const title =
    view === "day"
      ? fmtDay(anchor)
      : view === "week"
        ? `Week of ${startOfWeek(anchor).toLocaleDateString()}`
        : fmtMonth(anchor);

  return (
    <div className="space-y-[18px]">
      <PageHead
        title="Calendars"
        subtitle="Community calendar — single-property scope per event (BR-CC-6). Auto-publishes to Resident Center on save (BR-CC-10)."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={exportIcs}>
              <Download className="h-[13px] w-[13px]" /> .ics export
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setEditing(null);
                setCreatePreset({
                  propertyId: selectedPropertyIds[0] ?? properties[0]?.id,
                  start: new Date(),
                });
                setModalOpen(true);
              }}
              disabled={properties.length === 0}
            >
              <Plus className="h-[13px] w-[13px]" /> Add event
            </Button>
          </>
        }
      />

      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => shift(-1)}
              aria-label="Previous"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAnchor(new Date())}
            >
              Today
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => shift(1)}
              aria-label="Next"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            <CardTitle className="ml-3 text-base">{title}</CardTitle>
          </div>
          <div className="flex items-center gap-1 rounded border border-border bg-surface p-0.5">
            {(["day", "week", "month"] as CalendarView[]).map((v) => (
              <button
                key={v}
                type="button"
                className={
                  v === view
                    ? "rounded bg-primary px-3 py-1 text-xs font-semibold text-primary-fg"
                    : "rounded px-3 py-1 text-xs text-fg-muted hover:text-fg"
                }
                onClick={() => setView(v)}
              >
                {v.charAt(0).toUpperCase() + v.slice(1)}
              </button>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          <PropertyOverlayPicker
            properties={properties}
            selected={selectedPropertyIds}
            onToggle={togglePropertyOverlay}
            color={propertyColor}
          />

          <div className="mt-4">
            {loading ? (
              <p className="text-sm text-fg-muted">Loading…</p>
            ) : view === "month" ? (
              <MonthView
                anchor={anchor}
                viewWindow={viewWindow}
                rows={rows}
                propertyColor={propertyColor}
                onSlotClick={openCreateAt}
                onEventClick={openEdit}
                onEventDrop={rescheduleEvent}
              />
            ) : view === "week" ? (
              <WeekView
                anchor={anchor}
                rows={rows}
                propertyColor={propertyColor}
                onSlotClick={openCreateAt}
                onEventClick={openEdit}
                onEventDrop={rescheduleEvent}
              />
            ) : (
              <DayView
                anchor={anchor}
                rows={rows}
                propertyColor={propertyColor}
                onSlotClick={openCreateAt}
                onEventClick={openEdit}
                onEventDrop={rescheduleEvent}
              />
            )}
          </div>
        </CardContent>
      </Card>

      <CalendarEventModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSaved={load}
        properties={properties as CalendarEventModalPropertyOption[]}
        initial={editing}
        presetPropertyId={createPreset.propertyId}
        presetStart={createPreset.start ?? null}
        presetEnd={createPreset.end ?? null}
        timezone={orgInfo.timezone}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Property overlay picker (BR-CC-7 — max 15 simultaneous overlays).
// ---------------------------------------------------------------------------

function PropertyOverlayPicker({
  properties,
  selected,
  onToggle,
  color,
}: {
  properties: PropertyOption[];
  selected: string[];
  onToggle: (id: string) => void;
  color: Map<string, string>;
}) {
  if (properties.length === 0) {
    return (
      <p className="text-sm text-fg-muted">
        No properties yet — create a Property to start scheduling events.
      </p>
    );
  }
  return (
    <div className="flex flex-wrap gap-2">
      {properties.map((p) => {
        const isOn = selected.includes(p.id);
        const c = color.get(p.id) ?? "#94a3b8";
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => onToggle(p.id)}
            className={
              isOn
                ? "inline-flex items-center gap-1 rounded-full border border-border bg-surface-high px-2.5 py-0.5 text-xs text-fg"
                : "inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-0.5 text-xs text-fg-muted hover:text-fg"
            }
          >
            <span
              className="h-2 w-2 rounded-full"
              style={{ background: c }}
            />
            {p.propertyName}
          </button>
        );
      })}
      <span className="ml-2 text-xs text-fg-muted">
        {selected.length}/{CALENDAR_MAX_OVERLAYS} overlays
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Month view (6-week grid, days clickable to create).
// ---------------------------------------------------------------------------

function MonthView({
  anchor,
  viewWindow,
  rows,
  propertyColor,
  onSlotClick,
  onEventClick,
  onEventDrop,
}: {
  anchor: Date;
  viewWindow: { from: Date; to: Date };
  rows: EventRow[];
  propertyColor: Map<string, string>;
  onSlotClick: (day: Date) => void;
  onEventClick: (ev: EventRow) => void;
  onEventDrop: (ev: EventRow, newStart: Date) => Promise<void> | void;
}) {
  const days: Date[] = [];
  for (let i = 0; i < 42; i += 1) {
    days.push(new Date(viewWindow.from.getTime() + i * DAY_MS));
  }
  const eventsByDay = React.useMemo(() => {
    const map = new Map<string, EventRow[]>();
    for (const ev of rows) {
      const k = startOfDay(new Date(ev.startDate)).toISOString();
      const arr = map.get(k) ?? [];
      arr.push(ev);
      map.set(k, arr);
    }
    return map;
  }, [rows]);
  const currentMonth = anchor.getMonth();

  return (
    <div>
      <div className="grid grid-cols-7 border-b border-border text-xs text-fg-muted">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div key={d} className="px-2 py-1.5 text-center">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((day) => {
          const key = startOfDay(day).toISOString();
          const events = eventsByDay.get(key) ?? [];
          const inMonth = day.getMonth() === currentMonth;
          return (
            <div
              key={key}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                const id = e.dataTransfer.getData("text/event-id");
                const ev = rows.find((r) => r.id === id);
                if (!ev) return;
                // Preserve time-of-day from the dragged event.
                const orig = new Date(ev.startDate);
                const next = new Date(day);
                next.setHours(
                  orig.getHours(),
                  orig.getMinutes(),
                  0,
                  0,
                );
                void onEventDrop(ev, next);
              }}
              className={
                inMonth
                  ? "min-h-[88px] border-b border-r border-border p-1 align-top text-xs"
                  : "min-h-[88px] border-b border-r border-border bg-surface/40 p-1 align-top text-xs opacity-60"
              }
            >
              <button
                type="button"
                onClick={() => onSlotClick(day)}
                className="mb-1 text-left text-[11px] font-semibold text-fg hover:underline"
              >
                {day.getDate()}
              </button>
              <div className="space-y-0.5">
                {events.slice(0, 4).map((ev) => (
                  <EventChip
                    key={ev.occurrenceId}
                    ev={ev}
                    color={propertyColor.get(ev.propertyId) ?? "#94a3b8"}
                    onClick={() => onEventClick(ev)}
                  />
                ))}
                {events.length > 4 && (
                  <div className="px-1 text-[10px] text-fg-muted">
                    +{events.length - 4} more
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Week + Day views — flat list grouped by day.
// ---------------------------------------------------------------------------

function WeekView({
  anchor,
  rows,
  propertyColor,
  onSlotClick,
  onEventClick,
  onEventDrop,
}: {
  anchor: Date;
  rows: EventRow[];
  propertyColor: Map<string, string>;
  onSlotClick: (day: Date) => void;
  onEventClick: (ev: EventRow) => void;
  onEventDrop: (ev: EventRow, newStart: Date) => Promise<void> | void;
}) {
  const from = startOfWeek(anchor);
  const days: Date[] = Array.from({ length: 7 }, (_, i) => new Date(from.getTime() + i * DAY_MS));
  const today = new Date();
  return (
    <div className="grid gap-2 md:grid-cols-7">
      {days.map((day) => {
        const dayEvents = rows.filter((ev) =>
          sameDay(new Date(ev.startDate), day),
        );
        return (
          <div
            key={day.toISOString()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              const id = e.dataTransfer.getData("text/event-id");
              const ev = rows.find((r) => r.id === id);
              if (!ev) return;
              const orig = new Date(ev.startDate);
              const next = new Date(day);
              next.setHours(orig.getHours(), orig.getMinutes(), 0, 0);
              void onEventDrop(ev, next);
            }}
            className={
              sameDay(day, today)
                ? "min-h-[160px] rounded border border-primary/40 bg-surface p-2"
                : "min-h-[160px] rounded border border-border bg-surface p-2"
            }
          >
            <button
              type="button"
              onClick={() => onSlotClick(day)}
              className="mb-1 block text-left text-xs font-semibold text-fg hover:underline"
            >
              {day.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
            </button>
            <div className="space-y-1">
              {dayEvents.length === 0 && (
                <p className="text-[11px] text-fg-muted">No events</p>
              )}
              {dayEvents.map((ev) => (
                <EventChip
                  key={ev.occurrenceId}
                  ev={ev}
                  expanded
                  color={propertyColor.get(ev.propertyId) ?? "#94a3b8"}
                  onClick={() => onEventClick(ev)}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DayView({
  anchor,
  rows,
  propertyColor,
  onSlotClick,
  onEventClick,
  onEventDrop,
}: {
  anchor: Date;
  rows: EventRow[];
  propertyColor: Map<string, string>;
  onSlotClick: (day: Date) => void;
  onEventClick: (ev: EventRow) => void;
  onEventDrop: (ev: EventRow, newStart: Date) => Promise<void> | void;
}) {
  const dayEvents = rows
    .filter((ev) => sameDay(new Date(ev.startDate), anchor))
    .sort(
      (a, b) =>
        new Date(a.startDate).getTime() - new Date(b.startDate).getTime(),
    );
  return (
    <div
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        const id = e.dataTransfer.getData("text/event-id");
        const ev = rows.find((r) => r.id === id);
        if (!ev) return;
        const orig = new Date(ev.startDate);
        const next = new Date(anchor);
        next.setHours(orig.getHours(), orig.getMinutes(), 0, 0);
        void onEventDrop(ev, next);
      }}
      className="rounded border border-border bg-surface p-3"
    >
      <button
        type="button"
        onClick={() => onSlotClick(anchor)}
        className="mb-2 inline-flex items-center gap-1 text-xs text-fg-muted hover:text-fg"
      >
        <Plus className="h-3 w-3" /> Add event on this day
      </button>
      <div className="space-y-2">
        {dayEvents.length === 0 && (
          <p className="text-sm text-fg-muted">No events scheduled.</p>
        )}
        {dayEvents.map((ev) => (
          <EventChip
            key={ev.occurrenceId}
            ev={ev}
            expanded
            color={propertyColor.get(ev.propertyId) ?? "#94a3b8"}
            onClick={() => onEventClick(ev)}
          />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Event chip — used by all three views. Draggable for drag-to-reschedule.
// ---------------------------------------------------------------------------

function EventChip({
  ev,
  color,
  expanded,
  onClick,
}: {
  ev: EventRow;
  color: string;
  expanded?: boolean;
  onClick: () => void;
}) {
  const start = new Date(ev.startDate);
  const time = ev.allDay
    ? "All day"
    : start.toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
      });
  if (expanded) {
    return (
      <button
        type="button"
        draggable
        onDragStart={(e) =>
          e.dataTransfer.setData("text/event-id", ev.id)
        }
        onClick={onClick}
        className="block w-full rounded border-l-2 bg-surface-high px-2 py-1 text-left text-[11px] text-fg hover:bg-surface-highest"
        style={{ borderLeftColor: color }}
        title={ev.eventName}
      >
        <div className="font-semibold">{ev.eventName}</div>
        <div className="text-fg-muted">
          {time}
          {ev.linkedWorkOrderId && " · WO linked"}
          {ev.repeat !== "Does not repeat" && ` · ${ev.repeat}`}
        </div>
      </button>
    );
  }
  return (
    <button
      type="button"
      draggable
      onDragStart={(e) =>
        e.dataTransfer.setData("text/event-id", ev.id)
      }
      onClick={onClick}
      className="block w-full truncate rounded px-1 py-0.5 text-left text-[10px] text-white"
      style={{ background: color }}
      title={`${time} ${ev.eventName}`}
    >
      <span className="font-semibold">{time}</span> {ev.eventName}
    </button>
  );
}
