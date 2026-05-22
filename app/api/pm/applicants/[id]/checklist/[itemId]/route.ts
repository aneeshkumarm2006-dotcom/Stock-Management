// PATCH /api/pm/applicants/:id/checklist/:itemId
//
// Flip a single checklist item (BR-LA-5). Stamps `checkedAt` and
// `checkedByUserId` with the acting user. Pass `systemChecked=true` on the
// body to simulate BR-LA-7 (auto-check triggered by the self-serve email
// receipt) — only the Phase 6 ingest endpoint should pass that, but the
// route accepts it so the UI can dry-run.
import { NextResponse } from 'next/server';
import { Types, type Document } from 'mongoose';
import { z } from 'zod';
import { connectToDatabase } from '@/lib/db/mongoose';
import { Applicant } from '@/lib/db/models/pm/Applicant';
import type { IApplicantChecklistItem } from '@/lib/db/models/pm/Applicant';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { logActivity } from '@/lib/pm/activity';

export const runtime = 'nodejs';

const bodySchema = z.object({
  checked: z.boolean(),
  systemChecked: z.boolean().optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: { id: string; itemId: string } },
) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();

  if (
    !Types.ObjectId.isValid(params.id) ||
    !Types.ObjectId.isValid(params.itemId)
  ) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  await connectToDatabase();
  const orgId = new Types.ObjectId(ctx.orgId);
  const doc = await Applicant.findOne({
    _id: new Types.ObjectId(params.id),
    organizationId: orgId,
  });
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // `checklist` is a Mongoose DocumentArray at runtime — the `.id()` accessor
  // exists but is hidden behind the TS interface, hence the cast.
  type ChecklistDocArray = {
    id(id: string | Types.ObjectId):
      | (IApplicantChecklistItem & Document)
      | null;
  };
  const item = (
    doc.checklist as unknown as ChecklistDocArray
  ).id(new Types.ObjectId(params.itemId));
  if (!item) {
    return NextResponse.json(
      { error: 'Checklist item not found' },
      { status: 404 },
    );
  }

  item.checked = parsed.data.checked;
  if (parsed.data.checked) {
    item.checkedAt = new Date();
    item.systemChecked = parsed.data.systemChecked ?? false;
    item.checkedByUserId = parsed.data.systemChecked
      ? null
      : new Types.ObjectId(ctx.userId);
  } else {
    item.checkedAt = null;
    item.systemChecked = false;
    item.checkedByUserId = null;
  }
  await doc.save();

  await logActivity({
    orgId: ctx.orgId,
    parentType: 'Applicant',
    parentId: doc._id,
    eventType: parsed.data.checked
      ? 'Applicant checklist item checked'
      : 'Applicant checklist item unchecked',
    actorUserId: ctx.userId,
    payload: {
      stage: item.stage,
      label: item.label,
      systemChecked: parsed.data.systemChecked ?? false,
    },
  });

  return NextResponse.json({
    ok: true,
    checked: item.checked,
    systemChecked: item.systemChecked,
    checkedAt: item.checkedAt,
  });
}
