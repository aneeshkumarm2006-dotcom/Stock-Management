// POST /api/pm/1099/[vendorId]/send?year=2026 — emails the 1099 to the
// vendor via the existing Phase 6 system-email helper. The 1099 HTML
// is inlined as the message body (no file attachment dep needed).
// DECISIONS.md [G-S-30].
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { Vendor } from '@/lib/db/models/pm/Vendor';
import { Organization } from '@/lib/db/models/pm/Organization';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { render1099Html } from '@/lib/pm/form1099';
import { writeSystemEmail } from '@/lib/pm/systemEmail';
import { logActivity } from '@/lib/pm/activity';
import type { Tax1099FormType } from '@/types/pm';

export const runtime = 'nodejs';

export async function POST(
  request: Request,
  { params }: { params: { vendorId: string } },
) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();

  if (!Types.ObjectId.isValid(params.vendorId)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }

  const { searchParams } = new URL(request.url);
  const yearRaw = searchParams.get('year');
  const year =
    yearRaw && /^\d{4}$/.test(yearRaw)
      ? Number(yearRaw)
      : new Date().getFullYear() - 1;
  const formTypeParam = searchParams.get('formType');
  const formType: Tax1099FormType | undefined =
    formTypeParam === '1099-NEC' || formTypeParam === '1099-MISC'
      ? formTypeParam
      : undefined;

  await connectToDatabase();
  const orgObjectId = new Types.ObjectId(ctx.orgId);

  const vendor = await Vendor.findOne({
    _id: new Types.ObjectId(params.vendorId),
    organizationId: orgObjectId,
  }).lean<{
    firstName: string;
    lastName: string;
    companyName?: string;
    isCompany: boolean;
    primaryEmail?: string;
  } | null>();
  if (!vendor) {
    return NextResponse.json({ error: 'Vendor not found' }, { status: 404 });
  }
  if (!vendor.primaryEmail) {
    return NextResponse.json(
      { error: 'Vendor has no primary email on file.' },
      { status: 400 },
    );
  }

  const html = await render1099Html({
    orgId: orgObjectId,
    vendorId: params.vendorId,
    taxYear: year,
    formType,
  });
  if (!html) {
    return NextResponse.json(
      { error: 'No 1099 data for this vendor in this tax year.' },
      { status: 404 },
    );
  }

  const org = await Organization.findById(orgObjectId).lean<{
    name?: string;
    senderMailbox?: { defaultFrom?: string };
  } | null>();
  const fromMailbox =
    org?.senderMailbox?.defaultFrom ?? 'no-reply@managebuilding.local';

  const vendorName = vendor.isCompany
    ? vendor.companyName ?? `${vendor.firstName} ${vendor.lastName}`
    : `${vendor.firstName} ${vendor.lastName}`;

  await writeSystemEmail({
    orgId: orgObjectId,
    fromMailbox,
    senderUserId: ctx.userId,
    senderDisplayName: org?.name ?? 'Property Management',
    subject: `Your ${formType ?? '1099-NEC'} for tax year ${year}`,
    body: html,
    to: [
      {
        type: 'Vendor',
        id: params.vendorId,
        email: vendor.primaryEmail,
        name: vendorName,
      },
    ],
    relatedEntityType: 'Vendor',
    relatedEntityId: params.vendorId,
    eventType: '1099 sent',
  });

  await logActivity({
    orgId: ctx.orgId,
    parentType: 'Vendor',
    parentId: params.vendorId,
    eventType: '1099 sent',
    actorUserId: ctx.userId,
    payload: { taxYear: year, formType: formType ?? '1099-NEC' },
  });

  return NextResponse.json({ ok: true });
}
