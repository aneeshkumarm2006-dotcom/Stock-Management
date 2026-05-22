// Applicant CRUD (PDR §3.7). POST seeds the 14-default checklist (BR-LA-5)
// and assigns a monotonic per-org applicationNumber. The list view defaults
// to the open-funnel filter `status in ('New','Screening')`; pass
// `?includeClosed=1` to drop that filter for archive views.
//
// TODO Phase 6 — when the self-serve email link (BR-LA-4) creates an
// application via a public endpoint, the same POST helper auto-checks Stage 1
// item 1 with actor `System` (BR-LA-7). For Phase 3 the flag is wired via the
// checklist PATCH route's `systemChecked=true` body field.
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import {
  Applicant,
  buildDefaultApplicantChecklist,
  APPLICANT_CHECKLIST_TOTAL,
} from '@/lib/db/models/pm/Applicant';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { applicantCreateSchema } from '@/lib/validation/pm/applicant';
import { logActivity } from '@/lib/pm/activity';
import { APPLICANT_STATUSES, APPLICANT_SCREENING_STATUSES } from '@/types/pm';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();

  const { searchParams } = new URL(request.url);
  const includeClosed = searchParams.get('includeClosed') === '1';
  const statusParam = searchParams.get('status');
  const screeningParam = searchParams.get('screeningStatus');
  const q = searchParams.get('q')?.trim();

  await connectToDatabase();
  const filter: Record<string, unknown> = {
    organizationId: new Types.ObjectId(ctx.orgId),
  };
  if (statusParam) {
    const list = statusParam
      .split(',')
      .filter((v) => (APPLICANT_STATUSES as readonly string[]).includes(v));
    if (list.length > 0) filter.status = { $in: list };
  } else if (!includeClosed) {
    filter.status = { $in: ['New', 'Screening'] };
  }
  if (
    screeningParam &&
    (APPLICANT_SCREENING_STATUSES as readonly string[]).includes(screeningParam)
  ) {
    filter.screeningStatus = screeningParam;
  }
  if (q) {
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ firstName: rx }, { lastName: rx }, { email: rx }];
  }

  const rows = await Applicant.find(filter)
    .sort({ applicationReceivedAt: -1 })
    .lean();

  return NextResponse.json(
    rows.map((r) => {
      const checked = (r.checklist ?? []).filter((c) => c.checked).length;
      return {
        id: String(r._id),
        applicationNumber: r.applicationNumber,
        firstName: r.firstName,
        lastName: r.lastName,
        displayName: `${r.firstName} ${r.lastName}`.trim(),
        email: r.email ?? '',
        status: r.status,
        screeningStatus: r.screeningStatus,
        propertyId: r.propertyId ? String(r.propertyId) : null,
        unitId: r.unitId ? String(r.unitId) : null,
        applicationReceivedAt: r.applicationReceivedAt,
        checklistCheckedCount: checked,
        checklistTotal: APPLICANT_CHECKLIST_TOTAL,
        checklistOverallPct:
          APPLICANT_CHECKLIST_TOTAL === 0
            ? 0
            : Math.round((checked / APPLICANT_CHECKLIST_TOTAL) * 100),
        promotedToTenantId: r.promotedToTenantId
          ? String(r.promotedToTenantId)
          : null,
        sourceProspectId: r.sourceProspectId
          ? String(r.sourceProspectId)
          : null,
      };
    }),
  );
}

export async function POST(request: Request) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const parsed = applicantCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  await connectToDatabase();
  const orgId = new Types.ObjectId(ctx.orgId);
  const last = await Applicant.findOne({ organizationId: orgId })
    .sort({ applicationNumber: -1 })
    .select({ applicationNumber: 1 })
    .lean<{ applicationNumber: number } | null>();
  const applicationNumber = (last?.applicationNumber ?? 0) + 1;

  const doc = await Applicant.create({
    organizationId: orgId,
    firstName: parsed.data.firstName,
    lastName: parsed.data.lastName,
    applicationNumber,
    applicationReceivedAt: new Date(),
    status: 'New',
    email: parsed.data.email,
    phones: parsed.data.phones ?? [],
    propertyId: parsed.data.propertyId
      ? new Types.ObjectId(parsed.data.propertyId)
      : null,
    unitId: parsed.data.unitId ? new Types.ObjectId(parsed.data.unitId) : null,
    applicantAddress: parsed.data.applicantAddress ?? {},
    applicantBirthDate: parsed.data.applicantBirthDate
      ? new Date(parsed.data.applicantBirthDate)
      : null,
    applicantSsnLast4: parsed.data.applicantSsnLast4,
    rentalHistory: parsed.data.rentalHistory ?? [],
    employment: parsed.data.employment ?? [],
    checklist: buildDefaultApplicantChecklist(),
    screeningStatus: 'Not ordered',
    emailLinkToOnlineApplication:
      parsed.data.emailLinkToOnlineApplication ?? false,
    sourceProspectId: parsed.data.sourceProspectId
      ? new Types.ObjectId(parsed.data.sourceProspectId)
      : null,
    customFields: parsed.data.customFields ?? {},
  });

  // TODO Phase 6 — when the application arrived via the self-serve email
  // link, fire `Receive rental application` checklist auto-check with actor
  // = System (BR-LA-7). Phase 3 ships the public form as a stub.

  await logActivity({
    orgId: ctx.orgId,
    parentType: 'Applicant',
    parentId: doc._id,
    eventType: 'Applicant created',
    actorUserId: ctx.userId,
    payload: { applicationNumber },
  });

  return NextResponse.json(
    { id: String(doc._id), applicationNumber },
    { status: 201 },
  );
}
