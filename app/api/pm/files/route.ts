// Polymorphic File ingestion. POST accepts JSON metadata (Phase 0 ships the
// catalog only — Phase 8 layers real blob storage on top). The endpoint
// records the row, bumps the category `inUseCount`, and writes an
// ActivityLogEntry on the parent.
//
// Phase 0 deliberately skips an existence check on `locationId` for parent
// types whose collections don't exist yet (BR-FI-3 — "create a File against
// any parentType+parentId placeholder without FK errors"). Phase 1+ entities
// register themselves in `FK_VALIDATED_LOCATION_TYPES` to opt in.
import { NextResponse } from 'next/server';
import mongoose, { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { PmFile } from '@/lib/db/models/pm/PmFile';
import { FileCategory } from '@/lib/db/models/pm/FileCategory';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { pmFileCreateSchema } from '@/lib/validation/pm/pmFile';
import { logActivity } from '@/lib/pm/activity';
import {
  COLLECTION_BY_LOCATION_TYPE,
  FK_VALIDATED_LOCATION_TYPES,
  isParentType,
} from '@/lib/pm/parentTypes';

export const runtime = 'nodejs';

function serialize(d: Record<string, unknown>) {
  return {
    id: String(d._id),
    title: d.title,
    sharing: d.sharing,
    categoryId: String(d.categoryId),
    locationType: d.locationType,
    locationId: d.locationId ? String(d.locationId) : null,
    mimeType: d.mimeType,
    originalFilename: d.originalFilename,
    fileSize: d.fileSize,
    storageKey: d.storageKey,
    uploadedAt: d.createdAt,
    lastModifiedAt: d.lastModifiedAt,
    uploadedByUserId: String(d.uploadedByUserId),
    lastModifiedByUserId: String(d.lastModifiedByUserId),
  };
}

export async function GET(request: Request) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();

  const { searchParams } = new URL(request.url);
  const locationType = searchParams.get('locationType');
  const locationId = searchParams.get('locationId');
  const categoryId = searchParams.get('categoryId');

  await connectToDatabase();
  const filter: Record<string, unknown> = {
    organizationId: new Types.ObjectId(ctx.orgId),
  };
  if (locationType) filter.locationType = locationType;
  if (locationId && Types.ObjectId.isValid(locationId)) {
    filter.locationId = new Types.ObjectId(locationId);
  }
  if (categoryId && Types.ObjectId.isValid(categoryId)) {
    filter.categoryId = new Types.ObjectId(categoryId);
  }

  const rows = await PmFile.find(filter)
    .sort({ lastModifiedAt: -1 })
    .limit(500)
    .lean();

  return NextResponse.json(rows.map(serialize));
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

  const parsed = pmFileCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  await connectToDatabase();
  const orgObjectId = new Types.ObjectId(ctx.orgId);

  // Category must belong to this org.
  const category = await FileCategory.findOne({
    _id: new Types.ObjectId(parsed.data.categoryId),
    organizationId: orgObjectId,
  });
  if (!category) {
    return NextResponse.json(
      { error: 'Category not found in this organization' },
      { status: 400 },
    );
  }

  // FK existence check for Phase 1+ collections. Anything not in
  // FK_VALIDATED_LOCATION_TYPES is allowed through (placeholder pattern).
  if (
    parsed.data.locationType !== 'Account' &&
    parsed.data.locationId &&
    FK_VALIDATED_LOCATION_TYPES.has(parsed.data.locationType)
  ) {
    const collectionName = COLLECTION_BY_LOCATION_TYPE[parsed.data.locationType];
    const conn = mongoose.connection;
    if (collectionName && conn?.db) {
      const exists = await conn.db.collection(collectionName).countDocuments(
        {
          _id: new Types.ObjectId(parsed.data.locationId),
          organizationId: orgObjectId,
        },
        { limit: 1 },
      );
      if (exists === 0) {
        return NextResponse.json(
          {
            error: `${parsed.data.locationType} ${parsed.data.locationId} not found in this organization`,
          },
          { status: 400 },
        );
      }
    }
  }

  const now = new Date();
  const doc = await PmFile.create({
    organizationId: orgObjectId,
    title: parsed.data.title,
    sharing: parsed.data.sharing ?? 'Internal',
    categoryId: category._id,
    locationType: parsed.data.locationType,
    locationId: parsed.data.locationId
      ? new Types.ObjectId(parsed.data.locationId)
      : null,
    mimeType: parsed.data.mimeType,
    originalFilename: parsed.data.originalFilename,
    fileSize: parsed.data.fileSize,
    storageKey: parsed.data.storageKey,
    uploadedByUserId: new Types.ObjectId(ctx.userId),
    lastModifiedByUserId: new Types.ObjectId(ctx.userId),
    lastModifiedAt: now,
  });

  await FileCategory.updateOne(
    { _id: category._id },
    { $inc: { inUseCount: 1 } },
  );

  // Only log against the parent when the parent is a recognised polymorphic
  // type — `Account` is a synthetic non-parent.
  if (parsed.data.locationType !== 'Account' && parsed.data.locationId) {
    if (isParentType(parsed.data.locationType)) {
      await logActivity({
        orgId: ctx.orgId,
        parentType: parsed.data.locationType,
        parentId: parsed.data.locationId,
        eventType: 'File uploaded',
        actorUserId: ctx.userId,
        payload: { fileId: String(doc._id), title: doc.title },
      });
    }
  }

  return NextResponse.json(serialize(doc.toObject() as unknown as Record<string, unknown>), { status: 201 });
}
