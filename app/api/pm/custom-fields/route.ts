// Org-scoped custom field definitions (BR-CX-3). Listed/created via this route.
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { CustomFieldDefinition } from '@/lib/db/models/pm/CustomFieldDefinition';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { customFieldCreateSchema } from '@/lib/validation/pm/customField';
import { logActivity } from '@/lib/pm/activity';

export const runtime = 'nodejs';

function serialize(d: Record<string, unknown>) {
  return {
    id: String(d._id),
    entityType: d.entityType,
    key: d.key,
    label: d.label,
    fieldType: d.fieldType,
    enumOptions: d.enumOptions ?? null,
    required: d.required,
    order: d.order,
    active: d.active,
  };
}

export async function GET(request: Request) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();

  const { searchParams } = new URL(request.url);
  const entityType = searchParams.get('entityType') ?? undefined;
  const includeInactive = searchParams.get('includeInactive') === '1';

  await connectToDatabase();
  const filter: Record<string, unknown> = {
    organizationId: new Types.ObjectId(ctx.orgId),
  };
  if (entityType) filter.entityType = entityType;
  if (!includeInactive) filter.active = true;

  const rows = await CustomFieldDefinition.find(filter)
    .sort({ entityType: 1, order: 1, label: 1 })
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

  const parsed = customFieldCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  await connectToDatabase();
  try {
    const doc = await CustomFieldDefinition.create({
      organizationId: new Types.ObjectId(ctx.orgId),
      ...parsed.data,
    });

    await logActivity({
      orgId: ctx.orgId,
      parentType: 'Task',
      parentId: doc._id,
      eventType: 'Custom field created',
      actorUserId: ctx.userId,
      payload: { entityType: doc.entityType, key: doc.key },
    });

    return NextResponse.json(serialize(doc.toObject() as unknown as Record<string, unknown>), { status: 201 });
  } catch (err: unknown) {
    if (
      err &&
      typeof err === 'object' &&
      (err as { code?: number }).code === 11000
    ) {
      return NextResponse.json(
        { error: 'A custom field with this key already exists for this entity' },
        { status: 409 },
      );
    }
    throw err;
  }
}
