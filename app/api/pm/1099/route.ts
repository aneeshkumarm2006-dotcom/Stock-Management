// GET /api/pm/1099?year=2026 — vendor 1099 aggregation (DECISIONS.md
// [G-S-30]). Returns one row per Vendor with total paid in the year,
// computed alt-name + alt-address, TIN status, and the 1099 form type.
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { aggregateVendorPayments } from '@/lib/pm/form1099';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();

  const { searchParams } = new URL(request.url);
  const yearRaw = searchParams.get('year');
  const year =
    yearRaw && /^\d{4}$/.test(yearRaw)
      ? Number(yearRaw)
      : new Date().getFullYear() - 1;

  const rows = await aggregateVendorPayments({
    orgId: new Types.ObjectId(ctx.orgId),
    taxYear: year,
  });
  return NextResponse.json({ year, rows });
}
