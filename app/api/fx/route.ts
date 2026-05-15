// USD ↔ CAD rate for currency conversion across the app. Cached 24h inside
// getFxRate (Stage 4).
// Refs: PDR.md §7, §9, §11.
import { NextResponse } from 'next/server';
import {
  getCurrentUserId,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { getFxRate } from '@/lib/api-clients/exchangerate';
import { wantsRefresh } from '@/lib/utils/refreshParam';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const userId = await getCurrentUserId();
  if (!userId) return unauthorizedResponse();

  try {
    return NextResponse.json(await getFxRate(wantsRefresh(request)));
  } catch (err) {
    console.error('fx: fetch failed', err);
    return NextResponse.json(
      { error: 'FX rate temporarily unavailable' },
      { status: 502 },
    );
  }
}
