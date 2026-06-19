// Per-row CRUD on Vendor (PDR §3.11). PATCH supports soft-archive +
// reactivation via the `active` toggle (BR-MV-2 + [G-B-3]). DELETE is the
// same as PATCH `{ active: false }` for API ergonomics.
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
import { vendorUpdateSchema } from '@/lib/validation/pm/vendor';
import { logActivity } from '@/lib/pm/activity';

export const runtime = 'nodejs';

async function load(id: string, orgId: string) {
  if (!Types.ObjectId.isValid(id)) return null;
  await connectToDatabase();
  return Vendor.findOne({
    _id: new Types.ObjectId(id),
    organizationId: new Types.ObjectId(orgId),
  });
}

function daysUntil(date: Date | null | undefined): number | null {
  if (!date) return null;
  const ms = new Date(date).getTime() - Date.now();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();
  const doc = await load(params.id, ctx.orgId);
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const customFields: Record<string, unknown> = {};
  if (doc.customFields instanceof Map) {
    doc.customFields.forEach((v, k) => {
      customFields[k] = v;
    });
  } else if (doc.customFields) {
    Object.assign(customFields, doc.customFields);
  }

  return NextResponse.json({
    id: String(doc._id),
    firstName: doc.firstName ?? '',
    lastName: doc.lastName ?? '',
    isCompany: doc.isCompany,
    companyName: doc.companyName ?? '',
    displayName:
      doc.isCompany && doc.companyName
        ? doc.companyName
        : [doc.firstName, doc.lastName].filter(Boolean).join(' ').trim(),
    categoryId: doc.categoryId ? String(doc.categoryId) : null,
    expenseAccountId: doc.expenseAccountId ? String(doc.expenseAccountId) : null,
    accountNumber: doc.accountNumber ?? '',
    primaryEmail: doc.primaryEmail ?? '',
    alternateEmail: doc.alternateEmail ?? '',
    phones: doc.phones ?? {},
    address: doc.address ?? {},
    website: doc.website ?? '',
    comments: doc.comments ?? '',
    taxIdentityType: doc.taxIdentityType ?? null,
    taxpayerIdLast4: doc.taxpayerIdLast4 ?? '',
    use1099AlternateName: doc.use1099AlternateName,
    alternativeName1099: doc.alternativeName1099 ?? '',
    use1099AlternateAddress: doc.use1099AlternateAddress,
    alternativeAddress1099: doc.alternativeAddress1099 ?? null,
    insurance: doc.insurance ?? {},
    daysUntilInsuranceExpires: daysUntil(
      doc.insurance?.expirationDate ?? null,
    ),
    customFields,
    vendorPortalAccess: doc.vendorPortalAccess,
    active: doc.active,
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

  const parsed = vendorUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const doc = await load(params.id, ctx.orgId);
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (
    parsed.data.categoryId &&
    !(await VendorCategory.countDocuments({
      _id: new Types.ObjectId(parsed.data.categoryId),
      organizationId: new Types.ObjectId(ctx.orgId),
    }))
  ) {
    return NextResponse.json(
      { error: 'categoryId does not reference a vendor category in this org' },
      { status: 400 },
    );
  }
  if (
    parsed.data.expenseAccountId &&
    !(await ChartOfAccount.countDocuments({
      _id: new Types.ObjectId(parsed.data.expenseAccountId),
      organizationId: new Types.ObjectId(ctx.orgId),
    }))
  ) {
    return NextResponse.json(
      { error: 'expenseAccountId does not reference a chart-of-accounts row in this org' },
      { status: 400 },
    );
  }

  const wasActive = doc.active;

  const {
    categoryId,
    expenseAccountId,
    insurance,
    customFields,
    ...rest
  } = parsed.data;
  Object.assign(doc, rest);
  if (categoryId !== undefined) {
    doc.categoryId = categoryId ? new Types.ObjectId(categoryId) : null;
  }
  if (expenseAccountId !== undefined) {
    doc.expenseAccountId = expenseAccountId
      ? new Types.ObjectId(expenseAccountId)
      : null;
  }
  if (insurance !== undefined) {
    doc.insurance = {
      provider: insurance.provider,
      policyNumber: insurance.policyNumber,
      expirationDate: insurance.expirationDate
        ? new Date(insurance.expirationDate)
        : null,
    };
  }
  if (customFields !== undefined) {
    doc.customFields = new Map(Object.entries(customFields));
  }
  await doc.save();

  let eventType = 'Vendor updated';
  if (parsed.data.active === false && wasActive) {
    eventType = 'Vendor inactivated';
  } else if (parsed.data.active === true && !wasActive) {
    eventType = 'Vendor reactivated';
  }

  await logActivity({
    orgId: ctx.orgId,
    parentType: 'Vendor',
    parentId: doc._id,
    eventType,
    actorUserId: ctx.userId,
  });

  return NextResponse.json({ ok: true, active: doc.active });
}

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();
  const doc = await load(params.id, ctx.orgId);
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  doc.active = false;
  await doc.save();

  await logActivity({
    orgId: ctx.orgId,
    parentType: 'Vendor',
    parentId: doc._id,
    eventType: 'Vendor inactivated',
    actorUserId: ctx.userId,
  });

  return NextResponse.json({ ok: true });
}
