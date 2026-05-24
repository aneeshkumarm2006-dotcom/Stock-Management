// Per-user display preferences. GET returns the user's Settings (creating the
// default doc on first read so the app always has one — PDR §5.7), PUT updates
// it. Scoped to the session userId; never client-supplied.
// Refs: PDR.md §5.7, §6 (Settings), §9, §11.
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { connectToDatabase } from '@/lib/db/mongoose';
import { Settings } from '@/lib/db/models/Settings';
import {
  getCurrentUserId,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';

export const runtime = 'nodejs';

const DEFAULTS = {
  defaultCurrency: 'USD',
  theme: 'light',
  numberFormat: '1,234.56',
} as const;

const updateSchema = z
  .object({
    defaultCurrency: z.enum(['USD', 'CAD']).optional(),
    theme: z.enum(['dark', 'light']).optional(),
    numberFormat: z.enum(['1,234.56', '1.234,56', '1234.56']).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: 'No settings provided',
  });

function serialize(s: {
  defaultCurrency: string;
  theme: string;
  numberFormat: string;
}) {
  return {
    defaultCurrency: s.defaultCurrency,
    theme: s.theme,
    numberFormat: s.numberFormat,
  };
}

/** GET /api/settings — current user's preferences (default-created if absent). */
export async function GET() {
  const userId = await getCurrentUserId();
  if (!userId) return unauthorizedResponse();

  await connectToDatabase();
  const doc = await Settings.findOneAndUpdate(
    { userId },
    { $setOnInsert: { userId, ...DEFAULTS } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).lean();

  return NextResponse.json(serialize(doc ?? DEFAULTS));
}

/** PUT /api/settings — update one or more preferences. */
export async function PUT(request: Request) {
  const userId = await getCurrentUserId();
  if (!userId) return unauthorizedResponse();

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

  await connectToDatabase();
  const insertDefaults: Record<string, unknown> = { userId };
  for (const [key, value] of Object.entries(DEFAULTS)) {
    if (!(key in parsed.data)) insertDefaults[key] = value;
  }
  const doc = await Settings.findOneAndUpdate(
    { userId },
    { $set: parsed.data, $setOnInsert: insertDefaults },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).lean();

  return NextResponse.json(serialize(doc ?? { ...DEFAULTS, ...parsed.data }));
}
