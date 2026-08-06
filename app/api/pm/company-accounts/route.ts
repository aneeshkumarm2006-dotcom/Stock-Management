// CompanyAccount routes (PDR §3.28). An org is auto-seeded with one row named
// after the organization; POST (admin-only) adds the other legal entities that
// own its buildings. GET returns the list, sorted by name — it is the source
// for every "Property or company" scope picker.
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
import { companyAccountCreateSchema } from '@/lib/validation/pm/companyAccount';
import { serializeCompanyAccount } from './serialize';

export const runtime = 'nodejs';

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
  const parsed = companyAccountCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  await connectToDatabase();
  let doc;
  try {
    doc = await CompanyAccount.create({
      organizationId: new Types.ObjectId(ctx.orgId),
      name: parsed.data.name.trim(),
      defaultCashAccountId: parsed.data.defaultCashAccountId
        ? new Types.ObjectId(parsed.data.defaultCashAccountId)
        : null,
      currency: parsed.data.currency ?? undefined,
    });
  } catch (err) {
    // {organizationId, name} is unique — two same-named companies would be
    // indistinguishable in every scope dropdown.
    if ((err as { code?: number })?.code === 11000) {
      return NextResponse.json(
        { error: 'A company with that name already exists.' },
        { status: 409 },
      );
    }
    throw err;
  }

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
