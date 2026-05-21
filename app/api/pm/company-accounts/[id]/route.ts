// Per-row CompanyAccount ops. PATCH lets admins rename or wire a default
// cash account. DELETE soft-archives.
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { CompanyAccount } from '@/lib/db/models/pm/CompanyAccount';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { companyAccountUpdateSchema } from '@/lib/validation/pm/companyAccount';
import { logActivity } from '@/lib/pm/activity';
import { canManageOrg } from '@/lib/pm/roles';
import { serializeCompanyAccount } from '../route';

export const runtime = 'nodejs';

async function load(id: string, orgId: string) {
  if (!Types.ObjectId.isValid(id)) return null;
  await connectToDatabase();
  return CompanyAccount.findOne({
    _id: new Types.ObjectId(id),
    organizationId: new Types.ObjectId(orgId),
  });
}

export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();
  const doc = await load(params.id, ctx.orgId);
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(
    serializeCompanyAccount(doc.toObject() as unknown as Record<string, unknown>),
  );
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();
  if (!canManageOrg(ctx)) {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = companyAccountUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const doc = await load(params.id, ctx.orgId);
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (parsed.data.name !== undefined) doc.name = parsed.data.name;
  if (parsed.data.defaultCashAccountId !== undefined) {
    doc.defaultCashAccountId = parsed.data.defaultCashAccountId
      ? new Types.ObjectId(parsed.data.defaultCashAccountId)
      : null;
  }
  if (parsed.data.active !== undefined) doc.active = parsed.data.active;
  await doc.save();

  await logActivity({
    orgId: ctx.orgId,
    parentType: 'CompanyAccount',
    parentId: doc._id,
    eventType: 'Company account updated',
    actorUserId: ctx.userId,
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();
  if (!canManageOrg(ctx)) {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 });
  }
  const doc = await load(params.id, ctx.orgId);
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  doc.active = false;
  await doc.save();
  await logActivity({
    orgId: ctx.orgId,
    parentType: 'CompanyAccount',
    parentId: doc._id,
    eventType: 'Company account archived',
    actorUserId: ctx.userId,
  });
  return NextResponse.json({ ok: true });
}
