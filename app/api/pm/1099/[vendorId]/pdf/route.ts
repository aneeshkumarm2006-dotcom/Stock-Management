// GET /api/pm/1099/[vendorId]/pdf?year=2026 — printable 1099 page.
// Returns text/html with a print button; the user prints to PDF via
// the browser's "Save as PDF" command (industry-standard pattern,
// avoids a heavy PDF dep — DECISIONS.md [G-S-30]).
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { render1099Html } from '@/lib/pm/form1099';
import type { Tax1099FormType } from '@/types/pm';

export const runtime = 'nodejs';

export async function GET(
  request: Request,
  { params }: { params: { vendorId: string } },
) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();

  if (!Types.ObjectId.isValid(params.vendorId)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }

  const { searchParams } = new URL(request.url);
  const yearRaw = searchParams.get('year');
  const year =
    yearRaw && /^\d{4}$/.test(yearRaw)
      ? Number(yearRaw)
      : new Date().getFullYear() - 1;
  const formTypeParam = searchParams.get('formType');
  const formType: Tax1099FormType | undefined =
    formTypeParam === '1099-NEC' || formTypeParam === '1099-MISC'
      ? formTypeParam
      : undefined;

  const html = await render1099Html({
    orgId: new Types.ObjectId(ctx.orgId),
    vendorId: params.vendorId,
    taxYear: year,
    formType,
  });
  if (!html) {
    return NextResponse.json(
      { error: 'No 1099 data for this vendor in this tax year.' },
      { status: 404 },
    );
  }

  return new NextResponse(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
