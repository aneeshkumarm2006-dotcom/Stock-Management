// Vendor CRUD (PDR_MASTER §3.11). Soft-archive via `active` (BR-MV-2);
// reactivation [G-B-3] mirrors Property [G-B-2]. The list view surfaces
// insurance expiration so the EXPIRES column (BR-MV-4) can render the
// colour chip client-side.
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { Vendor } from '@/lib/db/models/pm/Vendor';
import { VendorCategory } from '@/lib/db/models/pm/VendorCategory';
import { ChartOfAccount } from '@/lib/db/models/pm/ChartOfAccount';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { vendorCreateSchema } from '@/lib/validation/pm/vendor';
import { logActivity } from '@/lib/pm/activity';

export const runtime = 'nodejs';

interface VendorLeanLike {
  _id: unknown;
  firstName: string;
  lastName: string;
  isCompany: boolean;
  companyName?: string;
  primaryEmail?: string;
  categoryId?: unknown;
  insurance?: { provider?: string; policyNumber?: string; expirationDate?: Date | null };
  active: boolean;
}

function displayName(d: VendorLeanLike): string {
  if (d.isCompany && d.companyName) return d.companyName;
  return [d.firstName, d.lastName].filter(Boolean).join(' ').trim();
}

function daysUntil(date: Date | null | undefined): number | null {
  if (!date) return null;
  const ms = new Date(date).getTime() - Date.now();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

async function ensureCategoryInOrg(
  id: string,
  orgId: string,
): Promise<boolean> {
  if (!Types.ObjectId.isValid(id)) return false;
  const cnt = await VendorCategory.countDocuments({
    _id: new Types.ObjectId(id),
    organizationId: new Types.ObjectId(orgId),
  });
  return cnt > 0;
}

async function ensureExpenseAccountInOrg(
  id: string,
  orgId: string,
): Promise<boolean> {
  if (!Types.ObjectId.isValid(id)) return false;
  const cnt = await ChartOfAccount.countDocuments({
    _id: new Types.ObjectId(id),
    organizationId: new Types.ObjectId(orgId),
  });
  return cnt > 0;
}

export async function GET(request: Request) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();

  const { searchParams } = new URL(request.url);
  const includeInactive = searchParams.get('includeInactive') === '1';
  const categoryId = searchParams.get('categoryId');
  const q = searchParams.get('q')?.trim();

  await connectToDatabase();
  const filter: Record<string, unknown> = {
    organizationId: new Types.ObjectId(ctx.orgId),
  };
  if (!includeInactive) filter.active = true;
  if (categoryId && Types.ObjectId.isValid(categoryId)) {
    filter.categoryId = new Types.ObjectId(categoryId);
  }
  if (q) {
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [
      { firstName: rx },
      { lastName: rx },
      { companyName: rx },
      { primaryEmail: rx },
    ];
  }

  const rows = await Vendor.find(filter)
    .sort({ lastName: 1, firstName: 1 })
    .lean<VendorLeanLike[]>();

  return NextResponse.json(
    rows.map((r) => ({
      id: String(r._id),
      firstName: r.firstName ?? '',
      lastName: r.lastName ?? '',
      isCompany: r.isCompany,
      companyName: r.companyName ?? '',
      primaryEmail: r.primaryEmail ?? '',
      displayName: displayName(r),
      categoryId: r.categoryId ? String(r.categoryId) : null,
      insuranceProvider: r.insurance?.provider ?? '',
      insuranceExpirationDate: r.insurance?.expirationDate ?? null,
      daysUntilInsuranceExpires: daysUntil(r.insurance?.expirationDate ?? null),
      active: r.active,
    })),
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

  const parsed = vendorCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  await connectToDatabase();

  if (
    parsed.data.categoryId &&
    !(await ensureCategoryInOrg(parsed.data.categoryId, ctx.orgId))
  ) {
    return NextResponse.json(
      { error: 'categoryId does not reference a vendor category in this org' },
      { status: 400 },
    );
  }
  if (
    parsed.data.expenseAccountId &&
    !(await ensureExpenseAccountInOrg(parsed.data.expenseAccountId, ctx.orgId))
  ) {
    return NextResponse.json(
      { error: 'expenseAccountId does not reference a chart-of-accounts row in this org' },
      { status: 400 },
    );
  }

  const doc = await Vendor.create({
    organizationId: new Types.ObjectId(ctx.orgId),
    firstName: parsed.data.firstName,
    lastName: parsed.data.lastName,
    isCompany: parsed.data.isCompany ?? false,
    companyName: parsed.data.companyName,
    categoryId: parsed.data.categoryId
      ? new Types.ObjectId(parsed.data.categoryId)
      : null,
    expenseAccountId: parsed.data.expenseAccountId
      ? new Types.ObjectId(parsed.data.expenseAccountId)
      : null,
    accountNumber: parsed.data.accountNumber,
    primaryEmail: parsed.data.primaryEmail,
    alternateEmail: parsed.data.alternateEmail,
    phones: parsed.data.phones,
    address: parsed.data.address,
    website: parsed.data.website,
    comments: parsed.data.comments,
    taxIdentityType: parsed.data.taxIdentityType ?? null,
    taxpayerIdLast4: parsed.data.taxpayerIdLast4,
    use1099AlternateName: parsed.data.use1099AlternateName ?? false,
    alternativeName1099: parsed.data.alternativeName1099,
    use1099AlternateAddress: parsed.data.use1099AlternateAddress ?? false,
    alternativeAddress1099: parsed.data.alternativeAddress1099,
    insurance: parsed.data.insurance
      ? {
          provider: parsed.data.insurance.provider,
          policyNumber: parsed.data.insurance.policyNumber,
          expirationDate: parsed.data.insurance.expirationDate
            ? new Date(parsed.data.insurance.expirationDate)
            : null,
        }
      : {},
    customFields: parsed.data.customFields ?? {},
    vendorPortalAccess: parsed.data.vendorPortalAccess ?? false,
  });

  await logActivity({
    orgId: ctx.orgId,
    parentType: 'Vendor',
    parentId: doc._id,
    eventType: 'Vendor created',
    actorUserId: ctx.userId,
    payload: { name: displayName(doc.toObject() as unknown as VendorLeanLike) },
  });

  return NextResponse.json({ id: String(doc._id) }, { status: 201 });
}
