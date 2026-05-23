// Polymorphic File ingestion. POST accepts JSON metadata (Phase 0 ships the
// catalog only — Phase 8 layers the central read surface, multi-filter list,
// search, and user/location display resolution on top). The endpoint
// records the row, bumps the category `inUseCount`, and writes an
// ActivityLogEntry on the parent.
//
// Phase 0 deliberately skips an existence check on `locationId` for parent
// types whose collections don't exist yet (BR-FI-3 — "create a File against
// any parentType+parentId placeholder without FK errors"). Phase 1+ entities
// register themselves in `FK_VALIDATED_LOCATION_TYPES` to opt in.
//
// Phase 8 GET adds:
//   - q                      free-text search over title + originalFilename
//   - sharing                Internal / Resident / Owner / PublicLink
//   - uploadedFrom/To        ISO dates (filters createdAt)
//   - modifiedFrom/To        ISO dates (filters lastModifiedAt)
//   - sort                   `lastModifiedAt | uploadedAt | title`  (default lastModifiedAt desc)
//   - dir                    `asc | desc`                          (default desc)
//   - expand=display         resolves user names (BR-FI-1: name preserved
//                            even when the uploader's OrgMembership is
//                            inactive — User.name persists) and location
//                            display strings.
// `total` is returned alongside `rows` so the page can render BR-CX-2's
// "matches" counter against post-filter row count.
import { NextResponse } from 'next/server';
import mongoose, { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { PmFile } from '@/lib/db/models/pm/PmFile';
import { FileCategory } from '@/lib/db/models/pm/FileCategory';
import { User } from '@/lib/db/models/User';
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
import { resolveLocationDisplays } from '@/lib/pm/locationDisplay';

export const runtime = 'nodejs';

const FILE_SORT_FIELDS = new Set(['lastModifiedAt', 'uploadedAt', 'title']);

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

function parseDate(s: string | null): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function GET(request: Request) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();

  const { searchParams } = new URL(request.url);
  const locationType = searchParams.get('locationType');
  const locationId = searchParams.get('locationId');
  const categoryId = searchParams.get('categoryId');
  const sharing = searchParams.get('sharing');
  const q = searchParams.get('q')?.trim() ?? '';
  const uploadedFrom = parseDate(searchParams.get('uploadedFrom'));
  const uploadedTo = parseDate(searchParams.get('uploadedTo'));
  const modifiedFrom = parseDate(searchParams.get('modifiedFrom'));
  const modifiedTo = parseDate(searchParams.get('modifiedTo'));
  const sortFieldRaw = searchParams.get('sort') ?? 'lastModifiedAt';
  const sortField = FILE_SORT_FIELDS.has(sortFieldRaw)
    ? sortFieldRaw
    : 'lastModifiedAt';
  const sortDir = searchParams.get('dir') === 'asc' ? 1 : -1;
  const expandDisplay = searchParams.get('expand') === 'display';

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
  if (sharing && ['Internal', 'Resident', 'Owner', 'PublicLink'].includes(sharing)) {
    filter.sharing = sharing;
  }
  if (q) {
    const re = new RegExp(escapeRegex(q), 'i');
    filter.$or = [{ title: re }, { originalFilename: re }];
  }
  const uploadedRange: Record<string, Date> = {};
  if (uploadedFrom) uploadedRange.$gte = uploadedFrom;
  if (uploadedTo) uploadedRange.$lte = uploadedTo;
  if (Object.keys(uploadedRange).length) filter.createdAt = uploadedRange;
  const modifiedRange: Record<string, Date> = {};
  if (modifiedFrom) modifiedRange.$gte = modifiedFrom;
  if (modifiedTo) modifiedRange.$lte = modifiedTo;
  if (Object.keys(modifiedRange).length) filter.lastModifiedAt = modifiedRange;

  // Translate the sort alias `uploadedAt` to the underlying `createdAt`.
  const sortKey = sortField === 'uploadedAt' ? 'createdAt' : sortField;
  const rows = await PmFile.find(filter)
    .sort({ [sortKey]: sortDir })
    .limit(500)
    .lean<Array<Record<string, unknown>>>();

  const total = await PmFile.countDocuments(filter);
  const serialized = rows.map(serialize);

  // Plain-list response when no display expansion requested (preserves
  // back-compat for child detail pages built in Phase 1–7).
  if (!expandDisplay) {
    return NextResponse.json(serialized);
  }

  // Resolve user names + location display strings in one round-trip each.
  const userIds = new Set<string>();
  const locations: { locationType: string; locationId: string | null }[] = [];
  for (const r of serialized) {
    userIds.add(r.uploadedByUserId);
    userIds.add(r.lastModifiedByUserId);
    locations.push({ locationType: r.locationType as string, locationId: r.locationId });
  }
  const userObjectIds = Array.from(userIds)
    .filter((id) => Types.ObjectId.isValid(id))
    .map((id) => new Types.ObjectId(id));
  const userDocs = await User.find({ _id: { $in: userObjectIds } })
    .select('_id name')
    .lean<Array<{ _id: Types.ObjectId; name: string }>>();
  const userById = Object.fromEntries(
    userDocs.map((u) => [String(u._id), u.name]),
  );
  const locDisplays = await resolveLocationDisplays(locations, ctx.orgId);

  const enriched = serialized.map((r) => ({
    ...r,
    uploadedByName: userById[r.uploadedByUserId] ?? '(former user)',
    lastModifiedByName: userById[r.lastModifiedByUserId] ?? '(former user)',
    locationDisplay:
      r.locationType === 'Account' || !r.locationId
        ? null
        : locDisplays[r.locationId] ?? null,
  }));

  return NextResponse.json({ rows: enriched, total });
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
