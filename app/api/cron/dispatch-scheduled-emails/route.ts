// Cron — promotes Scheduled emails whose `scheduledSendTime` has elapsed
// to Sent. Phase 6 stub: no real SMTP, just status flip + sentAt stamp +
// ActivityLog. Mirrors `app/api/cron/post-recurring-tasks/route.ts:11`
// for auth.
//
// `scheduledSendTime` is stored as UTC at rest ([G-B-23]); rendering in
// the user's org timezone happens client-side. The cron compares against
// `new Date()` which is UTC inside the Node runtime.
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { EmailMessage } from '@/lib/db/models/pm/EmailMessage';
import { logActivity } from '@/lib/pm/activity';
import type { ParentType } from '@/types/pm';

export const runtime = 'nodejs';

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // dev fallback
  const header = request.headers.get('authorization');
  return header === `Bearer ${secret}`;
}

interface DispatchableRow {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  senderUserId: Types.ObjectId;
  subject: string;
  relatedEntityType?: string | null;
  relatedEntityId?: Types.ObjectId | null;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  await connectToDatabase();

  // Phase 6 stub: no real outbound transport. We pick up everything
  // whose `scheduledSendTime` has elapsed in one pass; a real worker
  // would batch + retry.
  const now = new Date();
  const due = await EmailMessage.find({
    status: 'Scheduled',
    scheduledSendTime: { $lte: now },
  })
    .select('_id organizationId senderUserId subject relatedEntityType relatedEntityId')
    .lean<DispatchableRow[]>();

  let promoted = 0;
  const errors: Array<{ id: string; message: string }> = [];
  for (const row of due) {
    try {
      // Use save() to trigger the pre-save hook (stamps sentAt, clears
      // scheduledSendTime). Re-fetch the live document to avoid lean()
      // bypassing schema methods.
      const doc = await EmailMessage.findById(row._id);
      if (!doc) continue;
      doc.status = 'Sent';
      doc.scheduledSendTime = null;
      await doc.save();
      promoted++;

      await logActivity({
        orgId: row.organizationId,
        parentType: 'EmailMessage',
        parentId: row._id,
        eventType: 'Email sent',
        actorUserId: row.senderUserId,
        payload: { subject: row.subject, scheduledFired: true },
      });
      if (row.relatedEntityType && row.relatedEntityId) {
        await logActivity({
          orgId: row.organizationId,
          parentType: row.relatedEntityType as ParentType,
          parentId: row.relatedEntityId,
          eventType: 'Email sent',
          actorUserId: row.senderUserId,
          payload: {
            emailId: String(row._id),
            subject: row.subject,
            scheduledFired: true,
          },
        });
      }
    } catch (err) {
      errors.push({
        id: String(row._id),
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return NextResponse.json({
    inspected: due.length,
    promoted,
    errors,
    ranAt: now.toISOString(),
  });
}

export const POST = GET;
