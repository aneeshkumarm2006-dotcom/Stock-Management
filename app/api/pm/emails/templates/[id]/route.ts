// EmailTemplate detail (GET / PATCH / DELETE). Phase 6 minimal CRUD so the
// Compose modal can preview a template, and so the eventual /templates
// editor route has a backend to bind to.
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

export const runtime = 'nodejs';

interface RouteContext {
  params: { id: string };
}

async function loadTemplate(orgId: string, id: string) {
  if (!Types.ObjectId.isValid(id)) return null;
  await connectToDatabase();
  return EmailTemplate.findOne({
    _id: new Types.ObjectId(id),
    organizationId: new Types.ObjectId(orgId),
  });
}

export async function GET(_request: Request, { params }: RouteContext) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();
  const t = await loadTemplate(ctx.orgId, params.id);
  if (!t) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({
    id: String(t._id),
    name: t.name,
    subject: t.subject,
    body: t.body,
    variables: t.variables,
    type: t.type,
    audienceScope: t.audienceScope ?? null,
    active: t.active,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  });
}

export async function PATCH(request: Request, { params }: RouteContext) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();
  const t = await loadTemplate(ctx.orgId, params.id);
  if (!t) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const parsed = emailTemplateCreateSchema.partial().safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }
  Object.assign(t, parsed.data);
  await t.save();
  await logActivity({
    orgId: ctx.orgId,
    parentType: 'EmailTemplate',
    parentId: t._id,
    eventType: 'Email template updated',
    actorUserId: ctx.userId,
    payload: { fields: Object.keys(parsed.data) },
  });
  return NextResponse.json({ id: String(t._id) });
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();
  const t = await loadTemplate(ctx.orgId, params.id);
  if (!t) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  // Soft-archive — preserves historical FKs from EmailMessage.templateId.
  t.active = false;
  await t.save();
  await logActivity({
    orgId: ctx.orgId,
    parentType: 'EmailTemplate',
    parentId: t._id,
    eventType: 'Email template archived',
    actorUserId: ctx.userId,
    payload: { name: t.name },
  });
  return NextResponse.json({ ok: true });
}
