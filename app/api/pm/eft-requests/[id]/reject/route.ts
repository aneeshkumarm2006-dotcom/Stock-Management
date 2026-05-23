// EFT reject — sets status='Rejected' and stamps `approverUserId`. Does
// NOT post to the ledger (BR-AC-10); any linked Bill stays in its prior
// status.
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { EftRequest } from '@/lib/db/models/pm/EftRequest';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { eftRequestRejectSchema } from '@/lib/validation/pm/eftRequest';
import { logActivity } from '@/lib/pm/activity';

export const runtime = 'nodejs';

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();

  if (!Types.ObjectId.isValid(params.id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }

  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    // Empty body is fine — reason is optional.
  }
  const parsed = eftRequestRejectSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  await connectToDatabase();
  const eft = await EftRequest.findOne({
    _id: new Types.ObjectId(params.id),
    organizationId: new Types.ObjectId(ctx.orgId),
  });
  if (!eft) {
    return NextResponse.json({ error: 'EFT not found' }, { status: 404 });
  }
  if (eft.status !== 'Pending') {
    return NextResponse.json(
      { error: `Cannot reject from status=${eft.status}` },
      { status: 409 },
    );
  }

  // Phase 9 — any approver in the chain can reject; a single rejection
  // ends the chain (BR-AC-19). The rejecting user is captured in
  // `approvals[]` AND surfaced as `approverUserId` for backwards
  // compatibility with the Phase 4 read shape.
  eft.status = 'Rejected';
  eft.approverUserId = new Types.ObjectId(ctx.userId);
  eft.rejectionReason = parsed.data.reason;
  eft.approvals = [
    ...(eft.approvals ?? []),
    {
      userId: new Types.ObjectId(ctx.userId),
      decision: 'Rejected',
      at: new Date(),
      comment: parsed.data.reason,
    },
  ];
  await eft.save();

  await logActivity({
    orgId: ctx.orgId,
    parentType: 'EftRequest',
    parentId: eft._id,
    eventType: 'EFT rejected',
    actorUserId: ctx.userId,
    payload: { reason: parsed.data.reason ?? null },
  });

  return NextResponse.json({ ok: true, status: eft.status });
}
