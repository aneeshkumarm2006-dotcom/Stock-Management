// Per-user Dashboard widget layout (PROPERTY_TODO.md Phase 10 [G-B-10]).
// GET returns the caller's layout, creating defaults on first read so the
// dashboard always has a row. PUT replaces the items[] wholesale.
//
// Server validates every widgetId against the central registry — unknown
// IDs are stripped. Newly-registered widgets are appended at the end by
// `reconcileLayout` so users who already have a stored layout still see
// new widgets without manual intervention.
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { z } from 'zod';
import { connectToDatabase } from '@/lib/db/mongoose';
import { DashboardLayout } from '@/lib/db/models/pm/DashboardLayout';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import {
  DASHBOARD_WIDGET_IDS,
  defaultDashboardLayout,
  reconcileLayout,
} from '@/lib/pm/dashboardWidgets';

export const runtime = 'nodejs';

const layoutItemSchema = z.object({
  widgetId: z.string().min(1).max(64),
  enabled: z.boolean(),
  order: z.number().int().min(0).max(999),
});

const updateSchema = z.object({
  items: z.array(layoutItemSchema).min(1).max(64),
});

function serialize(d: {
  items: Array<{ widgetId: string; enabled: boolean; order: number }>;
}) {
  return {
    items: d.items.map((i) => ({
      widgetId: i.widgetId,
      enabled: i.enabled,
      order: i.order,
    })),
  };
}

export async function GET() {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();

  await connectToDatabase();
  const orgId = new Types.ObjectId(ctx.orgId);
  const userId = new Types.ObjectId(ctx.userId);

  const defaults = defaultDashboardLayout();
  const doc = await DashboardLayout.findOneAndUpdate(
    { organizationId: orgId, userId },
    { $setOnInsert: { organizationId: orgId, userId, items: defaults } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).lean();

  const items = reconcileLayout(doc?.items ?? defaults);
  return NextResponse.json(serialize({ items }));
}

export async function PUT(request: Request) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  // Drop unknown widget IDs server-side so a stale client can't corrupt the
  // layout doc with arbitrary strings.
  const cleaned = parsed.data.items.filter((i) =>
    DASHBOARD_WIDGET_IDS.has(i.widgetId),
  );
  const items = reconcileLayout(cleaned);

  await connectToDatabase();
  const orgId = new Types.ObjectId(ctx.orgId);
  const userId = new Types.ObjectId(ctx.userId);

  const doc = await DashboardLayout.findOneAndUpdate(
    { organizationId: orgId, userId },
    { $set: { items } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).lean();

  return NextResponse.json(serialize({ items: doc?.items ?? items }));
}
