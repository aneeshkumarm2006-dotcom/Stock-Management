// POST /api/pm/applicants/:id/convert-to-tenant
//
// Wraps `leasingPromotion.convertApplicantToTenant`. Enforces the [G-B-4]
// preconditions server-side: Approved status + Stage 1 complete + email +
// propertyId + unitId. The Move-in CTA in the UI is gated by the same
// checks client-side, but the truth is here.
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Types } from 'mongoose';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import {
  convertApplicantToTenant,
  PromotionError,
} from '@/lib/pm/leasingPromotion';

export const runtime = 'nodejs';

const bodySchema = z.object({
  leaseId: z
    .string()
    .refine((v) => Types.ObjectId.isValid(v))
    .nullable()
    .optional(),
});

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();

  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    // Empty body is fine — leaseId is optional.
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  try {
    const result = await convertApplicantToTenant(params.id, ctx, {
      leaseId: parsed.data.leaseId ?? null,
    });
    return NextResponse.json(
      {
        ok: true,
        tenantId: result.tenantId,
        alreadyPromoted: result.alreadyPromoted,
      },
      { status: result.alreadyPromoted ? 200 : 201 },
    );
  } catch (err) {
    if (err instanceof PromotionError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const msg = err instanceof Error ? err.message : 'Conversion failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
