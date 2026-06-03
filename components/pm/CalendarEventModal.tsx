// Create / edit CalendarEvent modal (Phase 7 — PDR_MASTER §3.34).
//
// Form layout mirrors Buildium's Create event surface:
//   - Property (required) — BR-CC-6 single-property scope.
//   - Event name (required) — gates the submit button.
//   - All-day toggle hides time inputs.
//   - Start/End date + time, 15-min granularity ([G-S-28]).
//   - Repeat + reminder enums.
//   - Location + description.
//   - Read-only `invitees: All tenants` (BR-CC-8) + timezone (BR-CC-9).
//
// Editing a recurring event surfaces a "this instance vs series" choice
// per DECISIONS [G-B-13]; the picker only appears when the row has a
// repeat cadence other than `Does not repeat`.
"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import {
  CALENDAR_REPEATS,
  CALENDAR_REMINDERS,
  type CalendarRepeat,
  type CalendarReminder,
  type CalendarEditScope,
} from "@/types/pm";
import { computeWarnings } from "@/lib/pm/warnings";
import { WarningInline } from "@/components/pm/WarningBadge";

export interface CalendarEventModalPropertyOption {
  id: string;
  propertyName: string;
}

export interface CalendarEventInitial {
  id?: string;
  propertyId: string;
  eventName: string;
  description?: string;
  startDate: string; // ISO
  endDate: string; // ISO
  allDay: boolean;
  repeat: CalendarRepeat;
  reminder: CalendarReminder;
  location?: string;
  recurrenceParentId?: string | null;
  timezone?: string;
  /** PmFile ids already attached on the event (edit mode). */
  attachments?: string[];
}

interface AttachmentChoice {
  id: string;
  title: string;
  originalFilename: string;
}

export interface CalendarEventModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
  properties: CalendarEventModalPropertyOption[];
  /** When provided, the modal is in edit mode. */
  initial?: CalendarEventInitial | null;
  /** Pre-fill propertyId on create. */
  presetPropertyId?: string;
  /** Pre-fill start date when "drag-to-create" on the grid. */
  presetStart?: Date | null;
  presetEnd?: Date | null;
  /** Org timezone label rendered read-only on the form. */
  timezone: string;
}

function toLocalInput(d: Date): { date: string; time: string } {
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

function fromLocalInput(date: string, time: string, allDay: boolean): Date {
  if (allDay) {
    const [y, m, d] = date.split("-").map(Number);
    return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1, 0, 0, 0, 0);
  }
  const [y, m, d] = date.split("-").map(Number);
  const [h, min] = time.split(":").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1, h ?? 0, min ?? 0, 0, 0);
}

export function CalendarEventModal({
  open,
  onClose,
  onSaved,
  properties,
  initial,
  presetPropertyId,
  presetStart,
  presetEnd,
  timezone,
}: CalendarEventModalProps) {
  const { toast } = useToast();
  const isEdit = !!initial?.id;
  const isRecurring =
    !!initial?.repeat && initial.repeat !== "Does not repeat";

  const defaultStart =
    initial?.startDate
      ? new Date(initial.startDate)
      : presetStart
        ? new Date(presetStart)
        : new Date();
  const defaultEnd =
    initial?.endDate
      ? new Date(initial.endDate)
      : presetEnd
        ? new Date(presetEnd)
        : new Date(defaultStart.getTime() + 60 * 60 * 1000);
  const startParts = toLocalInput(defaultStart);
  const endParts = toLocalInput(defaultEnd);

  const [propertyId, setPropertyId] = React.useState(
    initial?.propertyId ?? presetPropertyId ?? properties[0]?.id ?? "",
  );
  const [eventName, setEventName] = React.useState(initial?.eventName ?? "");
  const [description, setDescription] = React.useState(
    initial?.description ?? "",
  );
  const [allDay, setAllDay] = React.useState(initial?.allDay ?? false);
  const [startDate, setStartDate] = React.useState(startParts.date);
  const [startTime, setStartTime] = React.useState(startParts.time);
  const [endDate, setEndDate] = React.useState(endParts.date);
  const [endTime, setEndTime] = React.useState(endParts.time);
  const [repeat, setRepeat] = React.useState<CalendarRepeat>(
    initial?.repeat ?? "Does not repeat",
  );
  const [reminder, setReminder] = React.useState<CalendarReminder>(
    initial?.reminder ?? "None",
  );
  const [location, setLocation] = React.useState(initial?.location ?? "");
  const [editScope, setEditScope] =
    React.useState<CalendarEditScope>("series");
  const [saving, setSaving] = React.useState(false);

  // [G-B-16] — file attachments. `attachments` holds the selected file ids
  // (sent to the API); `attachmentChoices` is the catalog the picker draws
  // from, fetched lazily when the picker opens.
  const [attachments, setAttachments] = React.useState<string[]>(
    initial?.attachments ?? [],
  );
  const [attachmentMeta, setAttachmentMeta] = React.useState<
    Map<string, AttachmentChoice>
  >(new Map());
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [pickerLoading, setPickerLoading] = React.useState(false);
  const [pickerChoices, setPickerChoices] = React.useState<AttachmentChoice[]>(
    [],
  );
  const [pickerQuery, setPickerQuery] = React.useState("");

  // Reset state when the modal toggles open (so reopening doesn't keep
  // the previous selection).
  React.useEffect(() => {
    if (!open) return;
    setPropertyId(
      initial?.propertyId ?? presetPropertyId ?? properties[0]?.id ?? "",
    );
    setEventName(initial?.eventName ?? "");
    setDescription(initial?.description ?? "");
    setAllDay(initial?.allDay ?? false);
    const s = initial?.startDate
      ? new Date(initial.startDate)
      : presetStart ?? new Date();
    const e = initial?.endDate
      ? new Date(initial.endDate)
      : presetEnd ?? new Date(s.getTime() + 60 * 60 * 1000);
    const sp = toLocalInput(s);
    const ep = toLocalInput(e);
    setStartDate(sp.date);
    setStartTime(sp.time);
    setEndDate(ep.date);
    setEndTime(ep.time);
    setRepeat(initial?.repeat ?? "Does not repeat");
    setReminder(initial?.reminder ?? "None");
    setLocation(initial?.location ?? "");
    setEditScope("series");
    setAttachments(initial?.attachments ?? []);
    setPickerOpen(false);
    setPickerQuery("");
  }, [open, initial, presetPropertyId, presetStart, presetEnd, properties]);

  // Lazy-load the file catalog the first time the picker opens. The list
  // is cached for the modal session; reopening picks from the same set.
  React.useEffect(() => {
    if (!pickerOpen || pickerChoices.length > 0) return;
    let cancelled = false;
    void (async () => {
      setPickerLoading(true);
      const r = await fetch("/api/pm/files").catch(() => null);
      if (!cancelled && r?.ok) {
        const list = (await r.json()) as Array<{
          id: string;
          title: string;
          originalFilename: string;
        }>;
        setPickerChoices(
          list.map((f) => ({
            id: f.id,
            title: f.title,
            originalFilename: f.originalFilename,
          })),
        );
        setAttachmentMeta((prev) => {
          const next = new Map(prev);
          for (const f of list) {
            next.set(f.id, {
              id: f.id,
              title: f.title,
              originalFilename: f.originalFilename,
            });
          }
          return next;
        });
      }
      if (!cancelled) setPickerLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [pickerOpen, pickerChoices.length]);

  // Property / name / end>=start checks moved to non-blocking warnings.
  // The form can submit either way; the API stamps the warnings on the row.

  async function save() {
    const start = fromLocalInput(startDate, startTime, allDay);
    const end = fromLocalInput(endDate, endTime, allDay);

    // An event cannot end at or before it starts (ADD-014). Reject before the
    // API call so we don't post an inverted/zero-length window.
    if (end.getTime() <= start.getTime()) {
      toast({
        title: "End must be after start",
        description: "Adjust the end date/time so the event has a positive duration.",
        variant: "error",
      });
      return;
    }

    setSaving(true);

    const payload: Record<string, unknown> = {
      eventName: eventName.trim(),
      description: description.trim() || undefined,
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      allDay,
      repeat,
      reminder,
      location: location.trim() || undefined,
      attachments: attachments.length > 0 ? attachments : undefined,
    };

    let res: Response;
    if (isEdit && initial?.id) {
      payload.editScope = editScope;
      res = await fetch(`/api/pm/calendar-events/${initial.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } else {
      payload.propertyId = propertyId;
      res = await fetch("/api/pm/calendar-events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    }

    if (!res.ok) {
      setSaving(false);
      const errBody = (await res.json().catch(() => ({}))) as {
        error?: string;
      };
      toast({
        title: "Failed",
        description: errBody.error,
        variant: "error",
      });
      return;
    }

    setSaving(false);
    toast({
      title: isEdit ? "Event updated" : "Event published",
      description: isEdit ? undefined : "Visible to all active tenants on the property.",
      variant: "success",
    });
    onClose();
    await onSaved();
  }

  async function onDelete() {
    if (!isEdit || !initial?.id) return;
    if (!window.confirm("Delete this event?")) return;
    setSaving(true);
    const qs = isRecurring ? `?editScope=${editScope}` : "";
    const res = await fetch(`/api/pm/calendar-events/${initial.id}${qs}`, {
      method: "DELETE",
    });
    setSaving(false);
    if (!res.ok) {
      const errBody = (await res.json().catch(() => ({}))) as {
        error?: string;
      };
      toast({ title: "Delete failed", description: errBody.error, variant: "error" });
      return;
    }
    toast({ title: "Event deleted", variant: "success" });
    onClose();
    await onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader
          title={isEdit ? "Edit event" : "Create event"}
          description={
            isEdit
              ? undefined
              : "Auto-publishes to Resident Center on save — visible to all active tenants on the property (BR-CC-10)."
          }
          onClose={onClose}
        />
        <div className="space-y-4">
          {isRecurring && (
            <div className="rounded border border-border bg-surface p-3 text-sm">
              <Label className="mb-2 block">Edit applies to</Label>
              <div className="flex gap-3">
                <label className="flex items-center gap-2 text-fg">
                  <input
                    type="radio"
                    name="editScope"
                    checked={editScope === "instance"}
                    onChange={() => setEditScope("instance")}
                  />
                  This instance only
                </label>
                <label className="flex items-center gap-2 text-fg">
                  <input
                    type="radio"
                    name="editScope"
                    checked={editScope === "series"}
                    onChange={() => setEditScope("series")}
                  />
                  Entire series
                </label>
              </div>
            </div>
          )}

          <div className="space-y-1">
            <Label htmlFor="ce-prop">Property * (single-property scope, BR-CC-6)</Label>
            <select
              id="ce-prop"
              disabled={isEdit}
              className="w-full rounded border border-border bg-surface px-3 py-1.5 text-sm text-fg disabled:opacity-60"
              value={propertyId}
              onChange={(e) => setPropertyId(e.target.value)}
            >
              {properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.propertyName}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="ce-name">Event name *</Label>
            <Input
              id="ce-name"
              value={eventName}
              onChange={(e) => setEventName(e.target.value)}
              placeholder="e.g. Annual fire inspection"
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              id="ce-allday"
              type="checkbox"
              checked={allDay}
              onChange={(e) => setAllDay(e.target.checked)}
            />
            <Label htmlFor="ce-allday">All day</Label>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="ce-startd">Start date *</Label>
              <Input
                id="ce-startd"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            {!allDay && (
              <div className="space-y-1">
                <Label htmlFor="ce-startt">Start time</Label>
                <Input
                  id="ce-startt"
                  type="time"
                  step={900}
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                />
              </div>
            )}
            <div className="space-y-1">
              <Label htmlFor="ce-endd">End date *</Label>
              <Input
                id="ce-endd"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
            {!allDay && (
              <div className="space-y-1">
                <Label htmlFor="ce-endt">End time</Label>
                <Input
                  id="ce-endt"
                  type="time"
                  step={900}
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                />
              </div>
            )}
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="ce-repeat">Repeat</Label>
              <select
                id="ce-repeat"
                className="w-full rounded border border-border bg-surface px-3 py-1.5 text-sm text-fg"
                value={repeat}
                onChange={(e) => setRepeat(e.target.value as CalendarRepeat)}
              >
                {CALENDAR_REPEATS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="ce-reminder">Reminder</Label>
              <select
                id="ce-reminder"
                className="w-full rounded border border-border bg-surface px-3 py-1.5 text-sm text-fg"
                value={reminder}
                onChange={(e) => setReminder(e.target.value as CalendarReminder)}
              >
                {CALENDAR_REMINDERS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="ce-loc">Location</Label>
            <Input
              id="ce-loc"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="e.g. Lobby"
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="ce-desc">Description</Label>
            <textarea
              id="ce-desc"
              rows={3}
              className="w-full rounded border border-border bg-surface px-3 py-1.5 text-sm text-fg"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          {/* Attachments — [G-B-16]. File ids are sent in the payload; the
              underlying File rows already carry their own location, so this
              just records the association. */}
          <div className="space-y-1">
            <Label>Attachments</Label>
            {attachments.length === 0 && (
              <p className="text-xs text-fg-muted">No files attached.</p>
            )}
            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {attachments.map((id) => {
                  const meta = attachmentMeta.get(id);
                  return (
                    <span
                      key={id}
                      className="inline-flex items-center gap-1 rounded border border-border bg-surface-high px-2 py-0.5 text-xs text-fg"
                    >
                      {meta?.title ?? meta?.originalFilename ?? id}
                      <button
                        type="button"
                        onClick={() =>
                          setAttachments((prev) =>
                            prev.filter((x) => x !== id),
                          )
                        }
                        aria-label="Remove attachment"
                        className="text-fg-muted hover:text-error"
                      >
                        ×
                      </button>
                    </span>
                  );
                })}
              </div>
            )}
            {!pickerOpen ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setPickerOpen(true)}
              >
                Attach file
              </Button>
            ) : (
              <div className="space-y-2 rounded border border-border bg-surface p-2">
                <Input
                  type="search"
                  placeholder="Search files…"
                  value={pickerQuery}
                  onChange={(e) => setPickerQuery(e.target.value)}
                />
                <div className="max-h-40 overflow-y-auto">
                  {pickerLoading && (
                    <p className="text-xs text-fg-muted">Loading…</p>
                  )}
                  {!pickerLoading && pickerChoices.length === 0 && (
                    <p className="text-xs text-fg-muted">
                      No files in this org yet.
                    </p>
                  )}
                  {pickerChoices
                    .filter(
                      (f) =>
                        !pickerQuery ||
                        f.title
                          .toLowerCase()
                          .includes(pickerQuery.toLowerCase()) ||
                        f.originalFilename
                          .toLowerCase()
                          .includes(pickerQuery.toLowerCase()),
                    )
                    .filter((f) => !attachments.includes(f.id))
                    .slice(0, 50)
                    .map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() =>
                          setAttachments((prev) => [...prev, f.id])
                        }
                        className="block w-full truncate rounded px-2 py-1 text-left text-xs text-fg hover:bg-surface-high"
                      >
                        {f.title}
                        <span className="ml-1 text-fg-muted">
                          {f.originalFilename}
                        </span>
                      </button>
                    ))}
                </div>
                <div className="flex justify-end">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setPickerOpen(false)}
                  >
                    Done
                  </Button>
                </div>
              </div>
            )}
          </div>

          <div className="grid gap-2 rounded border border-border bg-surface p-3 text-sm text-fg-muted">
            <div>
              <span className="font-medium text-fg">Invitees:</span> All tenants (read-only, BR-CC-8)
            </div>
            <div>
              <span className="font-medium text-fg">Timezone:</span> {timezone} (org-level, read-only, BR-CC-9)
            </div>
          </div>

          <WarningInline
            warnings={computeWarnings(
              {
                propertyId,
                eventName,
                startDate: fromLocalInput(startDate, startTime, allDay),
                endDate: fromLocalInput(endDate, endTime, allDay),
              },
              "CalendarEvent",
            )}
          />
        </div>

        <DialogFooter>
          {isEdit && (
            <Button variant="destructive" onClick={onDelete} disabled={saving}>
              Delete
            </Button>
          )}
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving…" : isEdit ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
