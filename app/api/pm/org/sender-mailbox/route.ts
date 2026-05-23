// Sender-mailbox config (BR-CC-5, [G-B-21]). GET returns the current
// Organization.senderMailbox snapshot; PUT replaces it. Only Admins can
// edit ([G-B-22]).
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { Organization } from '@/lib/db/models/pm/Organization';
import { Property } from '@/lib/db/models/pm/Property';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { canManageOrg } from '@/lib/pm/roles';
import { logActivity } from '@/lib/pm/activity';
import { objectIdString } from '@/lib/validation/pm/parentRef';

export const runtime = 'nodejs';

const senderMailboxSchema = z.object({
  defaultFrom: z.string().trim().email().optional().nullable(),
  perPropertyOverrides: z
    .array(
      z.object({
        propertyId: objectIdString,
        mailbox: z.string().trim().email(),
      }),
    )
    .max(500)
    .default([]),
});

interface OrgRow {
  _id: Types.ObjectId;
  senderMailbox?: {
    defaultFrom?: string;
    perPropertyOverrides?: Map<string, string> | Record<string, string>;
  };
}

function overridesToList(
  overrides: Map<string, string> | Record<string, string> | undefined,
): Array<{ propertyId: string; mailbox: string }> {
  if (!overrides) return [];
  if (overrides instanceof Map) {
    return Array.from(overrides.entries()).map(([propertyId, mailbox]) => ({
      propertyId,
      mailbox,
    }));
  }
  return Object.entries(overrides).map(([propertyId, mailbox]) => ({
    propertyId,
    mailbox,
  }));
}

export async function GET() {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();
  await connectToDatabase();
  const org = await Organization.findById(ctx.orgId)
    .select('senderMailbox')
    .lean<OrgRow | null>();
  return NextResponse.json({
    defaultFrom: org?.senderMailbox?.defaultFrom ?? null,
    perPropertyOverrides: overridesToList(org?.senderMailbox?.perPropertyOverrides),
  });
}

export async function PUT(request: Request) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();
  if (!canManageOrg({ roles: ctx.roles })) {
    return NextResponse.json(
      { error: 'Only Admins can edit the sender mailbox configuration' },
      { status: 403 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const parsed = senderMailboxSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  await connectToDatabase();
  const orgOid = new Types.ObjectId(ctx.orgId);

  // Validate that every overriding propertyId exists in this org so a
  // typo doesn't leave a dangling override.
  if (parsed.data.perPropertyOverrides.length > 0) {
    const propIds = parsed.data.perPropertyOverrides.map(
      (o) => new Types.ObjectId(o.propertyId),
    );
    const count = await Property.countDocuments({
      _id: { $in: propIds },
      organizationId: orgOid,
    });
    if (count !== propIds.length) {
      return NextResponse.json(
        { error: 'One or more propertyId overrides do not exist in this org' },
        { status: 400 },
      );
    }
  }

  const overridesMap = new Map<string, string>();
  for (const o of parsed.data.perPropertyOverrides) {
    overridesMap.set(o.propertyId, o.mailbox.toLowerCase());
  }

  await Organization.updateOne(
    { _id: orgOid },
    {
      $set: {
        'senderMailbox.defaultFrom': parsed.data.defaultFrom
          ? parsed.data.defaultFrom.toLowerCase()
          : null,
        'senderMailbox.perPropertyOverrides': overridesMap,
      },
    },
  );

  await logActivity({
    orgId: ctx.orgId,
    // Org-level config writes don't have a dedicated parentType yet; bucket
    // them under the org-owner's User for now via the Task placeholder
    // pattern from Phase 0.
    parentType: 'Task',
    parentId: orgOid,
    eventType: 'Sender mailbox updated',
    actorUserId: ctx.userId,
    payload: {
      defaultFrom: parsed.data.defaultFrom ?? null,
      overrideCount: parsed.data.perPropertyOverrides.length,
    },
  });

  return NextResponse.json({ ok: true });
}
