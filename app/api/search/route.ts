// Symbol-search typeahead for the add-position panel. `?q=` is the partial
// query; the client debounces 300ms to spare Twelve Data credits (PDR §8).
// Results are cached 7 days inside searchSymbols (Stage 4).
// Refs: PDR.md §5.1, §7, §8; Tech_Stack.md §Folder Structure.
import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  getCurrentUserId,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { searchSymbols } from '@/lib/api-clients/twelvedata';

export const runtime = 'nodejs';

const querySchema = z.string().trim().min(1).max(40);

export async function GET(request: Request) {
  const userId = await getCurrentUserId();
  if (!userId) return unauthorizedResponse();

  const raw = new URL(request.url).searchParams.get('q') ?? '';
  const parsed = querySchema.safeParse(raw);
  if (!parsed.success) {
    // Empty/too-short query → no results rather than an error, so the
    // typeahead can clear cleanly while the user is still typing.
    return NextResponse.json({
      data: [],
      stale: false,
      cached: true,
      fetchedAt: new Date().toISOString(),
    });
  }

  try {
    const result = await searchSymbols(parsed.data);
    return NextResponse.json(result);
  } catch (err) {
    console.error('search: fetch failed', parsed.data, err);
    return NextResponse.json(
      { error: 'Search temporarily unavailable' },
      { status: 502 },
    );
  }
}
