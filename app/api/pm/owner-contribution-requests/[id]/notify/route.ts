// POST /api/pm/owner-contribution-requests/[id]/notify — send the
// rental owner a system-generated email containing the contribution
// request details (PDR §3.25, Phase 9). Uses the Phase 6
// `writeSystemEmail` helper so the message lands on the owner's
// Communications tab and the activity log.
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { OwnerContributionRequest } from '@/lib/db/models/pm/OwnerContributionRequest';
import { Organization } from '@/lib/db/models/pm/Organization';
import { RentalOwner } from '@/lib/db/models/pm/RentalOwner';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { writeSystemEmail } from '@/lib/pm/systemEmail';
import { formatUsd } from '@/lib/pm/currency';
import { logActivity } from '@/lib/pm/activity';

export const runtime = 'nodejs';

export async function POST(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();

  if (!Types.ObjectId.isValid(params.id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }

  await connectToDatabase();
  const orgObjectId = new Types.ObjectId(ctx.orgId);

  const ocr = await OwnerContributionRequest.findOne({
    _id: new Types.ObjectId(params.id),
    organizationId: orgObjectId,
  });
  if (!ocr) {
    return NextResponse.json(
      { error: 'OwnerContributionRequest not found' },
      { status: 404 },
    );
  }

  const owner = await RentalOwner.findOne({
    _id: ocr.requestedFromOwnerId,
    organizationId: orgObjectId,
  }).lean<{
    primaryEmail?: string;
    firstName: string;
    lastName: string;
    companyName?: string;
    isCompany: boolean;
  } | null>();
  if (!owner) {
    return NextResponse.json(
      { error: 'Linked rental owner not found' },
      { status: 404 },
    );
  }
  if (!owner.primaryEmail) {
    return NextResponse.json(
      { error: 'Owner has no primary email on file.' },
      { status: 400 },
    );
  }

  const org = await Organization.findById(orgObjectId).lean<{
    name: string;
    senderMailbox?: { defaultFrom?: string };
  } | null>();
  const fromMailbox =
    org?.senderMailbox?.defaultFrom ?? 'no-reply@managebuilding.local';

  const ownerName = owner.isCompany
    ? owner.companyName ?? `${owner.firstName} ${owner.lastName}`
    : `${owner.firstName} ${owner.lastName}`;

  const subject = `Funds contribution request — ${formatUsd(ocr.requestedAmount)}`;
  const body = [
    `Hello ${ownerName},`,
    '',
    `Your property manager has requested a funds contribution for the following:`,
    '',
    `  Amount requested: ${formatUsd(ocr.requestedAmount)}`,
    `  Properties:       ${ocr.propertiesScope}`,
    `  Due by:           ${ocr.dueDate.toISOString().slice(0, 10)}`,
    `  Priority:         ${ocr.priority}`,
    '',
    `Details:`,
    ocr.taskDescription,
    '',
    `Please reply to this email or contact your property manager to coordinate payment.`,
    '',
    `— ${org?.name ?? 'Property Management'}`,
  ].join('\n');

  await writeSystemEmail({
    orgId: orgObjectId,
    fromMailbox,
    senderUserId: ctx.userId,
    senderDisplayName: org?.name ?? 'Property Management',
    subject,
    body,
    to: [
      {
        type: 'RentalOwner',
        id: String(ocr.requestedFromOwnerId),
        email: owner.primaryEmail,
        name: ownerName,
      },
    ],
    relatedEntityType: 'RentalOwner',
    relatedEntityId: ocr.requestedFromOwnerId,
    eventType: 'Owner contribution request emailed',
  });

  await logActivity({
    orgId: ctx.orgId,
    parentType: 'OwnerContributionRequest',
    parentId: ocr._id,
    eventType: 'Owner contribution request emailed',
    actorUserId: ctx.userId,
    payload: { ownerEmail: owner.primaryEmail },
  });

  // Flip status from `New` → `In progress` once the owner is notified.
  if (ocr.status === 'New') {
    ocr.status = 'In progress';
    await ocr.save();
  }

  return NextResponse.json({ ok: true });
}
