// EmailTemplate list + create (PDR_MASTER §3.36, Phase 6).
// The dedicated /communication/templates editor stays ComingSoon; this
// route powers the Compose modal's template picker and the inline
// "Add template" affordance from PDR_communications §4.
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { EmailTemplate } from '@/lib/db/models/pm/EmailTemplate';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { emailTemplateCreateSchema } from '@/lib/validation/pm/emailTemplate';
import { logActivity } from '@/lib/pm/activity';
import { EMAIL_TEMPLATE_TYPES } from '@/types/pm';

export const runtime = 'nodejs';

interface TemplateRow {
  _id: unknown;
  name: string;
  subject: string;
  body: string;
  variables: string[];
  type: string;
  audienceScope?: string | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export async function GET(request: Request) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();

  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type');
  const audienceScope = searchParams.get('audienceScope');
  const activeOnly = searchParams.get('includeInactive') !== '1';

  await connectToDatabase();
  const filter: Record<string, unknown> = {
    organizationId: new Types.ObjectId(ctx.orgId),
  };
  if (activeOnly) filter.active = true;
  if (type && (EMAIL_TEMPLATE_TYPES as readonly string[]).includes(type)) {
    filter.type = type;
  }
  if (audienceScope) filter.audienceScope = audienceScope;

  const rows = await EmailTemplate.find(filter)
    .sort({ name: 1 })
    .lean<TemplateRow[]>();
  return NextResponse.json({
    items: rows.map((r) => ({
      id: String(r._id),
      name: r.name,
      subject: r.subject,
      body: r.body,
      variables: r.variables,
      type: r.type,
      audienceScope: r.audienceScope ?? null,
      active: r.active,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    })),
  });
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
  const parsed = emailTemplateCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  await connectToDatabase();
  const t = await EmailTemplate.create({
    organizationId: new Types.ObjectId(ctx.orgId),
    createdByUserId: new Types.ObjectId(ctx.userId),
    name: parsed.data.name,
    subject: parsed.data.subject,
    body: parsed.data.body,
    variables: parsed.data.variables,
    type: parsed.data.type,
    audienceScope: parsed.data.audienceScope ?? null,
    active: true,
  });
  await logActivity({
    orgId: ctx.orgId,
    parentType: 'EmailTemplate',
    parentId: t._id,
    eventType: 'Email template created',
    actorUserId: ctx.userId,
    payload: { name: t.name, type: t.type },
  });
  return NextResponse.json({ id: String(t._id) }, { status: 201 });
}
