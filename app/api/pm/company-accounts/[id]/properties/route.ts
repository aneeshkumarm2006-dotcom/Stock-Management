// GET /api/pm/company-accounts/[id]/properties
//
// The buildings a company owns, already resolved into the weighted set a
// company-level cost would be split across — including which properties are
// EXCLUDED and why. Powers the split preview in the recurring modal and the
// Buildings / Currency columns on the Companies settings page, so both read the
// same answer the poster will act on.
//
// No role gate, matching GET /api/pm/company-accounts: this is read-only
// reference data every scope picker needs.
import { NextResponse } from 'next/server';
import { connectToDatabase } from '@/lib/db/mongoose';
import { getPmContext, unauthorizedResponse } from '@/lib/auth/getCurrentUser';
import {
  resolveCompanyProperties,
  type AllocationBasis,
} from '@/lib/pm/companyProperties';

export const runtime = 'nodejs';

export async function GET(
  request: Request,
  { params }: { params: { id: string } },
) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();

  const { searchParams } = new URL(request.url);
  const basisParam = searchParams.get('basis');
  const basis: AllocationBasis = basisParam === 'Manual' ? 'Manual' : 'Equal';

  await connectToDatabase();
  const set = await resolveCompanyProperties({
    orgId: ctx.orgId,
    companyAccountId: params.id,
    basis,
  });
  if (!set) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json(set);
}
