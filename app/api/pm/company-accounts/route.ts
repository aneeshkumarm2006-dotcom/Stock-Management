// CompanyAccount routes (PDR §3.28). One row per org (auto-seeded). GET
// returns the list (typically one entry); POST is admin-only and rarely used.
// Full Company financials surface lands in Phase 9.
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { CompanyAccount } from '@/lib/db/models/pm/CompanyAccount';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { logActivity } from '@/lib/pm/activity';
import { canManageOrg } from '@/lib/pm/roles';
import { seedCompanyAccount } from '@/lib/pm/seed';

export const runtime = 'nodejs';

export function serializeCompanyAccount(d: Record<string, unknown>) {
  return {
    id: String(d._id),
    name: (d.name as string) ?? '',
    defaultCashAccountId: d.defaultCashAccountId
      ? String(d.defaultCashAccountId)
      : null,
    active: Boolean(d.active),
    createdAt:
      d.createdAt instanceof Date ? d.createdAt.toISOString() : String(d.createdAt),
  };
}

export async function GET() {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();

  await connectToDatabase();
  const orgObjectId = new Types.ObjectId(ctx.orgId);

  // Lazy seed for orgs predating Phase 2.
  const count = await CompanyAccount.countDocuments({ organizationId: orgObjectId });
  if (count === 0) {
    await seedCompanyAccount(orgObjectId);
  }

  const rows = await CompanyAccount.find({ organizationId: orgObjectId })
    .sort({ name: 1 })
    .lean();
  return NextResponse.json(
    rows.map((r) => serializeCompanyAccount(r as Record<string, unknown>)),
  );
}

export async function POST(request: Request) {
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
  const name = typeof (body as Record<string, unknown>)?.name === 'string'
    ? String((body as Record<string, unknown>).name)
    : null;
  if (!name) {
    return NextResponse.json({ error: 'name required' }, { status: 400 });
  }

  await connectToDatabase();
  const doc = await CompanyAccount.create({
    organizationId: new Types.ObjectId(ctx.orgId),
    name,
  });

  await logActivity({
    orgId: ctx.orgId,
    parentType: 'CompanyAccount',
    parentId: doc._id,
    eventType: 'Company account created',
    actorUserId: ctx.userId,
  });

  return NextResponse.json(
    serializeCompanyAccount(doc.toObject() as unknown as Record<string, unknown>),
    { status: 201 },
  );
}
