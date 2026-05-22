// Per-row CRUD on Applicant. `?reveal=ssn4` returns the masked SSN field when
// the caller has Admin/FinancialAdministrator — for the eye-icon reveal in
// the UI. Phase 3 stores ssnLast4 only; never the full SSN.
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import {
  Applicant,
  APPLICANT_CHECKLIST_TOTAL,
} from '@/lib/db/models/pm/Applicant';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { applicantUpdateSchema } from '@/lib/validation/pm/applicant';
import { logActivity } from '@/lib/pm/activity';
import { hasRole } from '@/lib/pm/roles';

export const runtime = 'nodejs';

async function load(id: string, orgId: string) {
  if (!Types.ObjectId.isValid(id)) return null;
  await connectToDatabase();
  return Applicant.findOne({
    _id: new Types.ObjectId(id),
    organizationId: new Types.ObjectId(orgId),
  });
}

function serializeChecklist(
  doc: NonNullable<Awaited<ReturnType<typeof load>>>,
  reveal: boolean,
) {
  return doc.checklist.map((item, idx) => ({
    id: String((item as { _id?: unknown })._id ?? idx),
    stage: item.stage,
    label: item.label,
    checked: item.checked,
    checkedAt: item.checkedAt ?? null,
    checkedByUserId: item.checkedByUserId ? String(item.checkedByUserId) : null,
    systemChecked: item.systemChecked,
    reveal,
  }));
}

export async function GET(
  request: Request,
  { params }: { params: { id: string } },
) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();
  const doc = await load(params.id, ctx.orgId);
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { searchParams } = new URL(request.url);
  const wantsSsn = searchParams.get('reveal') === 'ssn4';
  const canReveal = hasRole(ctx, 'Admin') || hasRole(ctx, 'FinancialAdministrator');
  const ssnExposed = wantsSsn && canReveal;

  const checked = doc.checklist.filter((c) => c.checked).length;

  return NextResponse.json({
    id: String(doc._id),
    applicationNumber: doc.applicationNumber,
    firstName: doc.firstName,
    lastName: doc.lastName,
    displayName: `${doc.firstName} ${doc.lastName}`.trim(),
    applicationReceivedAt: doc.applicationReceivedAt,
    status: doc.status,
    screeningStatus: doc.screeningStatus,
    email: doc.email ?? '',
    phones: doc.phones ?? [],
    propertyId: doc.propertyId ? String(doc.propertyId) : null,
    unitId: doc.unitId ? String(doc.unitId) : null,
    applicantAddress: doc.applicantAddress ?? {},
    applicantBirthDate: doc.applicantBirthDate ?? null,
    applicantSsnLast4: ssnExposed ? doc.applicantSsnLast4 ?? '' : '••••',
    canRevealSsn: canReveal,
    rentalHistory: doc.rentalHistory ?? [],
    employment: doc.employment ?? [],
    checklist: serializeChecklist(doc, ssnExposed),
    checklistCheckedCount: checked,
    checklistTotal: APPLICANT_CHECKLIST_TOTAL,
    checklistOverallPct:
      APPLICANT_CHECKLIST_TOTAL === 0
        ? 0
        : Math.round((checked / APPLICANT_CHECKLIST_TOTAL) * 100),
    emailLinkToOnlineApplication: doc.emailLinkToOnlineApplication,
    promotedToTenantId: doc.promotedToTenantId
      ? String(doc.promotedToTenantId)
      : null,
    promotedAt: doc.promotedAt ?? null,
    sourceProspectId: doc.sourceProspectId
      ? String(doc.sourceProspectId)
      : null,
    customFields: doc.customFields instanceof Map
      ? Object.fromEntries(doc.customFields)
      : doc.customFields ?? {},
  });
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const parsed = applicantUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const doc = await load(params.id, ctx.orgId);
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const {
    propertyId,
    unitId,
    applicantBirthDate,
    sourceProspectId,
    customFields,
    ...rest
  } = parsed.data;
  Object.assign(doc, rest);
  if (propertyId !== undefined) {
    doc.propertyId = propertyId ? new Types.ObjectId(propertyId) : null;
  }
  if (unitId !== undefined) {
    doc.unitId = unitId ? new Types.ObjectId(unitId) : null;
  }
  if (applicantBirthDate !== undefined) {
    doc.applicantBirthDate = applicantBirthDate
      ? new Date(applicantBirthDate)
      : null;
  }
  if (sourceProspectId !== undefined) {
    doc.sourceProspectId = sourceProspectId
      ? new Types.ObjectId(sourceProspectId)
      : null;
  }
  if (customFields !== undefined) {
    doc.customFields = new Map(Object.entries(customFields));
  }
  await doc.save();

  await logActivity({
    orgId: ctx.orgId,
    parentType: 'Applicant',
    parentId: doc._id,
    eventType: 'Applicant updated',
    actorUserId: ctx.userId,
    payload: rest.status ? { newStatus: rest.status } : undefined,
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();
  const doc = await load(params.id, ctx.orgId);
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (doc.promotedToTenantId) {
    return NextResponse.json(
      { error: 'Applicant has been promoted to a tenant and cannot be deleted.' },
      { status: 409 },
    );
  }
  await doc.deleteOne();
  await logActivity({
    orgId: ctx.orgId,
    parentType: 'Applicant',
    parentId: doc._id,
    eventType: 'Applicant deleted',
    actorUserId: ctx.userId,
  });
  return NextResponse.json({ ok: true });
}
