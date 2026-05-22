// Task helper utilities shared by API routes + UI (Phase 4 skeleton; Phase 5
// extends with the kanban/list surface). Encapsulates derivations so the
// status-roll-up rule for multi-WO Tasks ([G-B-33]) lives in one place.
import { TASK_TERMINAL_STATUSES, WORK_ORDER_TERMINAL_STATUSES } from '@/types/pm';
import type { TaskStatus, WorkOrderStatus } from '@/types/pm';

/** BR-TP-6 — a dueDate is past-due when it lies before today AND the task
 *  hasn't reached a terminal status. Used by the list view to colour-code
 *  the dueDate cell red. */
export function isPastDue(
  dueDate: Date | string | null | undefined,
  status: TaskStatus,
): boolean {
  if (!dueDate) return false;
  if ((TASK_TERMINAL_STATUSES as readonly string[]).includes(status)) {
    return false;
  }
  const d = typeof dueDate === 'string' ? new Date(dueDate) : dueDate;
  if (Number.isNaN(d.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return d < today;
}

/** Number of days between today and dueDate; positive = future,
 *  negative = past. Returns null when dueDate is missing or invalid. */
export function daysUntilDue(
  dueDate: Date | string | null | undefined,
): number | null {
  if (!dueDate) return null;
  const d = typeof dueDate === 'string' ? new Date(dueDate) : dueDate;
  if (Number.isNaN(d.getTime())) return null;
  const ms = d.getTime() - Date.now();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

/** [G-B-33] — derive a Task's effective completion based on its WorkOrders.
 *  Returns true ONLY when every WO is in a terminal status; the API uses
 *  this to validate Task → status='Completed' transitions. */
export function allWorkOrdersTerminal(
  woStatuses: ReadonlyArray<WorkOrderStatus>,
): boolean {
  if (woStatuses.length === 0) return true; // Tasks without WOs may close freely
  return woStatuses.every((s) =>
    (WORK_ORDER_TERMINAL_STATUSES as readonly string[]).includes(s),
  );
}
