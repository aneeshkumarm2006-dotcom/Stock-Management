"use client";

// Customize Dashboard modal — drag-to-reorder + show/hide per widget
// (PROPERTY_TODO.md Phase 10 [G-B-10]). Uses @dnd-kit/sortable for the drag
// affordance and persists the result via PUT /api/pm/dashboard-layout.
//
// UX:
//  - Local draft state seeded from the current layout. Drag updates order,
//    checkbox toggles enabled. Cancel reverts. Save PUTs and closes.
//  - Reorder works regardless of enabled state; hidden widgets keep their
//    rank so re-enabling brings them back where they were.
import * as React from "react";
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
} from "@/components/ui/dialog";
import { DASHBOARD_WIDGETS } from "@/lib/pm/dashboardWidgets";
import type { LayoutItem } from "./DashboardGrid";
import { cn } from "@/lib/utils/cn";

const TITLE_BY_ID = new Map(DASHBOARD_WIDGETS.map((w) => [w.id, w.title]));

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  layout: LayoutItem[];
  onSaved: (next: LayoutItem[]) => void;
}

export function CustomizeDashboardModal({
  open,
  onOpenChange,
  layout,
  onSaved,
}: Props) {
  const [draft, setDraft] = React.useState<LayoutItem[]>(() =>
    layout.map((i) => ({ ...i })),
  );
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Re-seed when the modal opens so a Cancel/Reopen cycle starts fresh.
  React.useEffect(() => {
    if (open) {
      setDraft(layout.map((i) => ({ ...i })));
      setError(null);
    }
  }, [open, layout]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = draft.findIndex((d) => d.widgetId === active.id);
    const newIndex = draft.findIndex((d) => d.widgetId === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const reordered = arrayMove(draft, oldIndex, newIndex).map((d, i) => ({
      ...d,
      order: i,
    }));
    setDraft(reordered);
  };

  const toggle = (widgetId: string) => {
    setDraft((d) =>
      d.map((i) =>
        i.widgetId === widgetId ? { ...i, enabled: !i.enabled } : i,
      ),
    );
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/pm/dashboard-layout", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ items: draft }),
      });
      if (!res.ok) {
        setError("Couldn’t save layout. Please try again.");
        return;
      }
      const json = (await res.json()) as { items: LayoutItem[] };
      onSaved(json.items);
      onOpenChange(false);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader
          title="Customize dashboard"
          description="Drag to reorder. Uncheck to hide a widget."
          onClose={() => onOpenChange(false)}
        />
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={draft.map((d) => d.widgetId)}
            strategy={verticalListSortingStrategy}
          >
            <ul className="max-h-[60vh] space-y-1 overflow-y-auto pr-1">
              {draft.map((item) => (
                <CustomizeRow
                  key={item.widgetId}
                  item={item}
                  onToggle={toggle}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
        {error && (
          <p className="mt-3 text-xs text-error" role="alert">
            {error}
          </p>
        )}
        <DialogFooter>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded border border-border px-3 py-1.5 text-xs font-bold uppercase tracking-widest text-fg-muted hover:bg-surface-high hover:text-fg"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="rounded bg-primary px-3 py-1.5 text-xs font-bold uppercase tracking-widest text-primary-fg hover:bg-primary-container disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CustomizeRow({
  item,
  onToggle,
}: {
  item: LayoutItem;
  onToggle: (widgetId: string) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.widgetId });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  const title = TITLE_BY_ID.get(item.widgetId) ?? item.widgetId;
  return (
    <li
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex items-center gap-3 rounded border border-border bg-surface-low p-2",
        isDragging && "z-10 shadow-lg",
      )}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label={`Drag ${title}`}
        className="cursor-grab text-fg-muted hover:text-fg active:cursor-grabbing"
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <span className="flex-1 text-sm font-medium text-fg">{title}</span>
      <label className="flex items-center gap-2 text-xs text-fg-muted">
        <input
          type="checkbox"
          checked={item.enabled}
          onChange={() => onToggle(item.widgetId)}
          className="h-4 w-4 rounded border-border accent-primary"
        />
        Show
      </label>
    </li>
  );
}

export default CustomizeDashboardModal;
