// Per-row PmFile ops. PATCH updates metadata (title/sharing/category) and
// bumps `lastModifiedAt`. DELETE removes the row + decrements category
// inUseCount (BR-FI-6 keeps the counter accurate).
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { PmFile } from '@/lib/db/models/pm/PmFile';
import { FileCategory } from '@/lib/db/models/pm/FileCategory';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { pmFileUpdateSchema } from '@/lib/validation/pm/pmFile';
import { logActivity } from '@/lib/pm/activity';
import { isParentType } from '@/lib/pm/parentTypes';

export const runtime = 'nodejs';

async function load(id: string, orgId: string) {
  if (!Types.ObjectId.isValid(id)) return null;
  await connectToDatabase();
  return PmFile.findOne({
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
  return NextResponse.json({
    id: String(doc._id),
    title: doc.title,
    sharing: doc.sharing,
    categoryId: String(doc.categoryId),
    locationType: doc.locationType,
    locationId: doc.locationId ? String(doc.locationId) : null,
    mimeType: doc.mimeType,
    originalFilename: doc.originalFilename,
    fileSize: doc.fileSize,
    storageKey: doc.storageKey,
    uploadedAt: doc.createdAt,
    lastModifiedAt: doc.lastModifiedAt,
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

  const parsed = pmFileUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const doc = await load(params.id, ctx.orgId);
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const oldCategoryId = doc.categoryId;
  if (parsed.data.title) doc.title = parsed.data.title;
  if (parsed.data.sharing) doc.sharing = parsed.data.sharing;
  if (parsed.data.categoryId) {
    const newCat = await FileCategory.findOne({
      _id: new Types.ObjectId(parsed.data.categoryId),
      organizationId: new Types.ObjectId(ctx.orgId),
    });
    if (!newCat) {
      return NextResponse.json(
        { error: 'Category not found in this organization' },
        { status: 400 },
      );
    }
    doc.categoryId = newCat._id;
  }
  doc.lastModifiedByUserId = new Types.ObjectId(ctx.userId);
  doc.lastModifiedAt = new Date();
  await doc.save();

  if (
    parsed.data.categoryId &&
    String(oldCategoryId) !== String(doc.categoryId)
  ) {
    await Promise.all([
      FileCategory.updateOne(
        { _id: oldCategoryId },
        { $inc: { inUseCount: -1 } },
      ),
      FileCategory.updateOne(
        { _id: doc.categoryId },
        { $inc: { inUseCount: 1 } },
      ),
    ]);
  }

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

  const categoryId = doc.categoryId;
  await doc.deleteOne();
  await FileCategory.updateOne(
    { _id: categoryId },
    { $inc: { inUseCount: -1 } },
  );

  if (doc.locationType !== 'Account' && doc.locationId) {
    if (isParentType(doc.locationType)) {
      await logActivity({
        orgId: ctx.orgId,
        parentType: doc.locationType,
        parentId: doc.locationId,
        eventType: 'File deleted',
        actorUserId: ctx.userId,
        payload: { title: doc.title },
      });
    }
  }

  return NextResponse.json({ ok: true });
}
