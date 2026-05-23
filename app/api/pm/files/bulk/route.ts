// Bulk file operations for the central Files surface (PDR §3.29 §4.3,
// PROPERTY_TODO Phase 8). Supports three actions:
//   - delete  → removes selected rows + decrements category inUseCount
//   - move    → reassigns categoryId; bumps the old/new category counts
//   - share   → updates sharing enum
//
// Each action enforces org scope, bumps `lastModifiedAt` + `lastModifiedByUserId`
// (BR-FI-8 — `lastModifiedByUserId` is unwritable from the client) and writes
// one ActivityLogEntry per affected row whose parent is a real polymorphic
// entity (BR-CX-4).
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { z } from 'zod';
import { connectToDatabase } from '@/lib/db/mongoose';
import { PmFile } from '@/lib/db/models/pm/PmFile';
import { FileCategory } from '@/lib/db/models/pm/FileCategory';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { logActivity } from '@/lib/pm/activity';
import { isParentType } from '@/lib/pm/parentTypes';
import { objectIdString } from '@/lib/validation/pm/parentRef';

export const runtime = 'nodejs';

const bulkSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('delete'),
    ids: z.array(objectIdString).min(1).max(200),
  }),
  z.object({
    action: z.literal('move'),
    ids: z.array(objectIdString).min(1).max(200),
    categoryId: objectIdString,
  }),
  z.object({
    action: z.literal('share'),
    ids: z.array(objectIdString).min(1).max(200),
    sharing: z.enum(['Internal', 'Resident', 'Owner', 'PublicLink']),
  }),
]);

export async function POST(request: Request) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const parsed = bulkSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  await connectToDatabase();
  const orgObjectId = new Types.ObjectId(ctx.orgId);
  const ids = parsed.data.ids.map((id) => new Types.ObjectId(id));

  const docs = await PmFile.find({
    _id: { $in: ids },
    organizationId: orgObjectId,
  });
  if (docs.length === 0) {
    return NextResponse.json({ error: 'No matching files' }, { status: 404 });
  }

  if (parsed.data.action === 'delete') {
    // Tally per-category decrement counts before deleting.
    const decByCategory = new Map<string, number>();
    for (const d of docs) {
      const key = String(d.categoryId);
      decByCategory.set(key, (decByCategory.get(key) ?? 0) + 1);
    }
    await PmFile.deleteMany({
      _id: { $in: docs.map((d) => d._id) },
      organizationId: orgObjectId,
    });
    await Promise.all(
      Array.from(decByCategory.entries()).map(([catId, n]) =>
        FileCategory.updateOne(
          { _id: new Types.ObjectId(catId), organizationId: orgObjectId },
          { $inc: { inUseCount: -n } },
        ),
      ),
    );
    await Promise.all(
      docs.flatMap((d) => {
        if (d.locationType === 'Account' || !d.locationId) return [];
        if (!isParentType(d.locationType)) return [];
        return [
          logActivity({
            orgId: ctx.orgId,
            parentType: d.locationType,
            parentId: d.locationId,
            eventType: 'File deleted',
            actorUserId: ctx.userId,
            payload: { title: d.title },
          }),
        ];
      }),
    );
    return NextResponse.json({ ok: true, deleted: docs.length });
  }

  if (parsed.data.action === 'move') {
    const newCat = await FileCategory.findOne({
      _id: new Types.ObjectId(parsed.data.categoryId),
      organizationId: orgObjectId,
    });
    if (!newCat) {
      return NextResponse.json(
        { error: 'Target category not found' },
        { status: 400 },
      );
    }
    const now = new Date();
    const incByOld = new Map<string, number>();
    let movedToNew = 0;
    for (const d of docs) {
      const oldKey = String(d.categoryId);
      if (oldKey === String(newCat._id)) continue;
      incByOld.set(oldKey, (incByOld.get(oldKey) ?? 0) + 1);
      movedToNew += 1;
    }
    await PmFile.updateMany(
      { _id: { $in: docs.map((d) => d._id) }, organizationId: orgObjectId },
      {
        $set: {
          categoryId: newCat._id,
          lastModifiedAt: now,
          lastModifiedByUserId: new Types.ObjectId(ctx.userId),
        },
      },
    );
    await Promise.all([
      ...Array.from(incByOld.entries()).map(([catId, n]) =>
        FileCategory.updateOne(
          { _id: new Types.ObjectId(catId), organizationId: orgObjectId },
          { $inc: { inUseCount: -n } },
        ),
      ),
      movedToNew > 0
        ? FileCategory.updateOne(
            { _id: newCat._id },
            { $inc: { inUseCount: movedToNew } },
          )
        : Promise.resolve(),
    ]);
    await Promise.all(
      docs.flatMap((d) => {
        if (d.locationType === 'Account' || !d.locationId) return [];
        if (!isParentType(d.locationType)) return [];
        return [
          logActivity({
            orgId: ctx.orgId,
            parentType: d.locationType,
            parentId: d.locationId,
            eventType: 'File recategorized',
            actorUserId: ctx.userId,
            payload: { title: d.title, categoryId: String(newCat._id) },
          }),
        ];
      }),
    );
    return NextResponse.json({ ok: true, moved: movedToNew });
  }

  // action === 'share'
  const sharing = parsed.data.sharing;
  const now = new Date();
  await PmFile.updateMany(
    { _id: { $in: docs.map((d) => d._id) }, organizationId: orgObjectId },
    {
      $set: {
        sharing,
        lastModifiedAt: now,
        lastModifiedByUserId: new Types.ObjectId(ctx.userId),
      },
    },
  );
  await Promise.all(
    docs.flatMap((d) => {
      if (d.locationType === 'Account' || !d.locationId) return [];
      if (!isParentType(d.locationType)) return [];
      return [
        logActivity({
          orgId: ctx.orgId,
          parentType: d.locationType,
          parentId: d.locationId,
          eventType: 'File sharing changed',
          actorUserId: ctx.userId,
          payload: { title: d.title, sharing },
        }),
      ];
    }),
  );
  return NextResponse.json({ ok: true, updated: docs.length });
}
