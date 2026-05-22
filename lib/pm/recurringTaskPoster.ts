// recurringTaskPoster — worker that scans active RecurringTasks and spawns
// a fresh Task instance when `nextDate - 0 <= today` AND
// `lastPostedDate < nextDate`. (RecurringTask has no `postNDaysInAdvance`
// because Tasks don't post to the ledger — the rule fires on the date.)
//
// Reuses `advanceNextDate` from recurringPoster.ts so the date math stays
// identical to the RecurringTransaction cadence engine.
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { RecurringTask } from '@/lib/db/models/pm/RecurringTask';
import { Task } from '@/lib/db/models/pm/Task';
import { nextTaskId } from '@/lib/pm/taskIdSequence';
import { advanceNextDate } from '@/lib/pm/recurringPoster';
import { logActivity } from '@/lib/pm/activity';

interface PostOneResult {
  recurringTaskId: string;
  posted: boolean;
  taskId?: number;
  taskObjectId?: string;
  note?: string;
}

export async function runRecurringTaskPoster(
  now: Date = new Date(),
): Promise<PostOneResult[]> {
  await connectToDatabase();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  const candidates = await RecurringTask.find({ active: true });
  const results: PostOneResult[] = [];

  for (const rule of candidates) {
    const triggerDate = new Date(rule.nextDate);
    triggerDate.setHours(0, 0, 0, 0);
    const lastPosted = rule.lastPostedDate
      ? new Date(rule.lastPostedDate)
      : null;

    if (lastPosted && lastPosted >= rule.nextDate) {
      results.push({
        recurringTaskId: String(rule._id),
        posted: false,
        note: 'Already posted',
      });
      continue;
    }
    if (today < triggerDate) {
      results.push({
        recurringTaskId: String(rule._id),
        posted: false,
        note: 'Not yet due',
      });
      continue;
    }

    try {
      const orgId = String(rule.organizationId);
      const taskId = await nextTaskId(orgId);
      const task = await Task.create({
        organizationId: rule.organizationId,
        taskId,
        title: rule.title,
        taskType: rule.taskType,
        status: 'New',
        priority: rule.priority,
        dueDate: rule.nextDate,
        categoryId: rule.categoryId ?? null,
        propertyId: rule.propertyId ?? null,
        unitId: rule.unitId ?? null,
        vendors: [],
        assignees: rule.assignees ?? [],
        collaborators: [],
        description: rule.description,
        workOrders: [],
        projectIds: [],
        createdByUserId: rule.createdByUserId,
      });

      await logActivity({
        orgId,
        parentType: 'Task',
        parentId: task._id,
        eventType: 'Task generated from RecurringTask',
        actorUserId: rule.createdByUserId,
        payload: {
          recurringTaskId: String(rule._id),
          taskId,
          cadence: rule.cadence,
        },
      });

      rule.lastPostedDate = rule.nextDate;
      rule.postedCount = (rule.postedCount ?? 0) + 1;
      rule.nextDate = advanceNextDate(rule.nextDate, rule.cadence);

      if (
        rule.duration === 'End after N' &&
        typeof rule.occurrenceCount === 'number' &&
        rule.postedCount >= rule.occurrenceCount
      ) {
        rule.active = false;
      }

      await rule.save();

      results.push({
        recurringTaskId: String(rule._id),
        posted: true,
        taskId,
        taskObjectId: String(task._id),
      });
    } catch (err) {
      results.push({
        recurringTaskId: String(rule._id),
        posted: false,
        note: err instanceof Error ? err.message : 'Posting failed',
      });
    }
  }
  return results;
}

/** Test seam — also used by API routes when a manual "run now" surface lands. */
export type { PostOneResult };
export { Types };
