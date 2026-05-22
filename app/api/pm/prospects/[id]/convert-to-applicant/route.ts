// POST /api/pm/prospects/:id/convert-to-applicant
//
// Wraps `leasingPromotion.convertProspectToApplicant`. BR-LA-3: the
// conversion is one-way; subsequent calls on the same Prospect are no-ops
// that return the existing Applicant id.
import { NextResponse } from 'next/server';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import {
  convertProspectToApplicant,
  PromotionError,
} from '@/lib/pm/leasingPromotion';

export const runtime = 'nodejs';

export async function POST(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();

  try {
    const result = await convertProspectToApplicant(params.id, ctx);
    return NextResponse.json(
      {
        ok: true,
        applicantId: result.applicantId,
        alreadyConverted: result.alreadyConverted,
      },
      { status: result.alreadyConverted ? 200 : 201 },
    );
  } catch (err) {
    if (err instanceof PromotionError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const msg = err instanceof Error ? err.message : 'Conversion failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
