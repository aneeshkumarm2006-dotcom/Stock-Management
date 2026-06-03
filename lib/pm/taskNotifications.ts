// Task notification writers + past-due escalation sweep (Phase 5).
//
// Decisions (DECISIONS.md Phase 5):
//   [G-S-40] Three triggers: assignment, terminal-transition, past-due.
//   [G-B-34] Daily cron writes one Notification per assignee when a Task
//            crosses past-due; dedupes via a marker title lookup so re-running
//            on the same day yields zero duplicates.
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { Notification } from '@/lib/db/models/pm/Notification';
import { Task, TASK_TERMINAL_STATUSES_DB } from '@/lib/db/models/pm/Task';
import type { ITask } from '@/lib/db/models/pm/Task';

const PAST_DUE_TITLE = 'Past-due task';

interface TaskRef {
  _id: Types.ObjectId | string;
  organizationId: Types.ObjectId | string;
  taskId: number;
  title: string;
}

function taskLink(task: TaskRef): string {
  return `/properties/tasks/${String(task._id)}`;
}

/** Fire-and-forget notification fan-out for newly added assignees. */
export async function notifyTaskAssigned(
  task: TaskRef,
  newAssigneeIds: Array<Types.ObjectId | string>,
): Promise<void> {
  if (newAssigneeIds.length === 0) return;
  await connectToDatabase();
  await Notification.insertMany(
    newAssigneeIds.map((uid) => ({
      organizationId: new Types.ObjectId(String(task.organizationId)),
      recipientUserId: new Types.ObjectId(String(uid)),
      kind: 'info',
      title: `Assigned: ${task.title}`,
      body: `Task #${task.taskId}`,
      link: taskLink(task),
    })),
    { ordered: false },
  ).catch((err) => {
    console.error('notifyTaskAssigned failed', err);
  });
}

/** Notify assignees + collaborators when a Task transitions to terminal. */
export async function notifyTaskCompleted(
  task: ITask & { _id: Types.ObjectId },
): Promise<void> {
  const recipients = [
    ...(task.assignees ?? []),
    ...(task.collaborators ?? []),
  ];
  if (recipients.length === 0) return;
  await connectToDatabase();
  await Notification.insertMany(
    recipients.map((uid) => ({
      organizationId: task.organizationId,
      recipientUserId: uid,
      kind: 'info',
      title: `Completed: ${task.title}`,
      body: `Task #${task.taskId} reached status ${task.status}`,
      link: taskLink(task),
    })),
    { ordered: false },
  ).catch((err) => {
    console.error('notifyTaskCompleted failed', err);
  });
}

interface EscalationResult {
  scanned: number;
  taskIds: number[];
  notificationsWritten: number;
}

/**
 * [G-B-34] daily sweep — for each non-terminal Task whose dueDate < today,
 * write one Notification per assignee. Dedupes against existing past-due
 * notifications for the same Task by matching title=PAST_DUE_TITLE +
 * body containing the Task ObjectId string.
 */
export async function escalatePastDueTasks(
  now: Date = new Date(),
): Promise<EscalationResult> {
  await connectToDatabase();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  const overdue = await Task.find({
    dueDate: { $lt: today, $ne: null },
    status: { $nin: TASK_TERMINAL_STATUSES_DB },
  })
    .select('_id organizationId taskId title assignees')
    .lean<
      Array<{
        _id: Types.ObjectId;
        organizationId: Types.ObjectId;
        taskId: number;
        title: string;
        assignees: Types.ObjectId[];
      }>
    >();

  let written = 0;
  const taskIds: number[] = [];

  for (const t of overdue) {
    if (!t.assignees || t.assignees.length === 0) continue;

    // DEL-009: dedupe PER RECIPIENT, not org-wide. The previous code skipped
    // the entire fan-out when ANY one assignee had a prior past-due
    // notification for this task, so newly-added assignees were never
    // notified. Fetch the set of recipients who already have a past-due
    // notification for THIS task (single query), then insert only for the
    // assignees missing from that set.
    const existingRows = await Notification.find({
      organizationId: t.organizationId,
      title: PAST_DUE_TITLE,
      body: { $regex: `Task #${t.taskId}\\b` },
    })
      .select('recipientUserId')
      .lean<Array<{ recipientUserId: Types.ObjectId }>>();
    const alreadyNotified = new Set(
      existingRows.map((r) => String(r.recipientUserId)),
    );

    const toNotify = t.assignees.filter(
      (uid) => !alreadyNotified.has(String(uid)),
    );
    if (toNotify.length === 0) continue;

    await Notification.insertMany(
      toNotify.map((uid) => ({
        organizationId: t.organizationId,
        recipientUserId: uid,
        kind: 'warning',
        title: PAST_DUE_TITLE,
        body: `Task #${t.taskId} — ${t.title}`,
        link: taskLink(t),
      })),
      { ordered: false },
    );
    written += toNotify.length;
    taskIds.push(t.taskId);
  }

  return { scanned: overdue.length, taskIds, notificationsWritten: written };
}
