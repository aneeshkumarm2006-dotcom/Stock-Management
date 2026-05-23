// POST /api/pm/owner-contribution-requests/[id]/record-payment —
// records a partial or full payment against an owner contribution
// request (PDR §3.25, Phase 9). Increments `receivedAmount` (cents),
// auto-flips status to `Completed` when received >= requested, and
// posts the matching JE:
//
//   debit  BankAccount cash CoA  (per-property or company scope)
//   credit Owner Contribution    (Equity, scope Company)
//
// Locked-period gate honored. Body: { amount (dollars), bankAccountId,
// date (ISO), propertyId? }.
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { z } from 'zod';
import { connectToDatabase } from '@/lib/db/mongoose';
import { OwnerContributionRequest } from '@/lib/db/models/pm/OwnerContributionRequest';
import { BankAccount } from '@/lib/db/models/pm/BankAccount';
import { ChartOfAccount } from '@/lib/db/models/pm/ChartOfAccount';
import { JournalEntry } from '@/lib/db/models/pm/JournalEntry';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { toCents, formatUsd } from '@/lib/pm/currency';
import { assertWriteAllowed, LockedPeriodError } from '@/lib/pm/lockedPeriod';
import { logActivity } from '@/lib/pm/activity';

export const runtime = 'nodejs';

const objectIdString = z
  .string()
  .refine((v) => Types.ObjectId.isValid(v), { message: 'Invalid id' });

const recordPaymentSchema = z.object({
  amount: z.number().positive(),
  bankAccountId: objectIdString,
  date: z.string().min(8),
  propertyId: objectIdString.optional(),
});

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();

  if (!Types.ObjectId.isValid(params.id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const parsed = recordPaymentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const txnDate = new Date(parsed.data.date);
  if (Number.isNaN(txnDate.getTime())) {
    return NextResponse.json({ error: 'Invalid date' }, { status: 400 });
  }

  await connectToDatabase();
  const orgObjectId = new Types.ObjectId(ctx.orgId);

  const ocr = await OwnerContributionRequest.findOne({
    _id: new Types.ObjectId(params.id),
    organizationId: orgObjectId,
  });
  if (!ocr) {
    return NextResponse.json(
      { error: 'OwnerContributionRequest not found' },
      { status: 404 },
    );
  }

  const bank = await BankAccount.findOne({
    _id: new Types.ObjectId(parsed.data.bankAccountId),
    organizationId: orgObjectId,
  }).lean<{ chartOfAccountId?: Types.ObjectId | null } | null>();
  if (!bank) {
    return NextResponse.json(
      { error: 'BankAccount not found' },
      { status: 400 },
    );
  }
  if (!bank.chartOfAccountId) {
    return NextResponse.json(
      {
        error:
          'BankAccount has no Chart of Accounts mapping. Configure it before recording the contribution.',
      },
      { status: 400 },
    );
  }

  const ownerCoA = await ChartOfAccount.findOne({
    organizationId: orgObjectId,
    defaultFor: 'Owner Contribution',
  }).lean<{ _id: Types.ObjectId } | null>();
  if (!ownerCoA) {
    return NextResponse.json(
      {
        error:
          'No Owner Contribution CoA configured for this org. Run the system seeder.',
      },
      { status: 400 },
    );
  }

  try {
    await assertWriteAllowed({
      orgId: ctx.orgId,
      txnDate,
      scopePropertyId: parsed.data.propertyId ?? null,
      ctx,
    });
  } catch (err) {
    if (err instanceof LockedPeriodError) {
      return NextResponse.json(
        { error: err.policyMessage, policyId: err.policyId },
        { status: 423 },
      );
    }
    throw err;
  }

  const amountCents = toCents(parsed.data.amount);
  const propertyScopeId = parsed.data.propertyId
    ? new Types.ObjectId(parsed.data.propertyId)
    : null;

  const je = await JournalEntry.create({
    organizationId: orgObjectId,
    date: txnDate,
    scopeType: propertyScopeId ? 'Property' : 'Company',
    scopeId: propertyScopeId,
    memo: `Owner contribution — ${ocr.propertiesScope}`.slice(0, 256),
    lines: [
      {
        accountId: bank.chartOfAccountId,
        scopeType: propertyScopeId ? 'Property' : 'Company',
        scopeId: propertyScopeId,
        unitId: null,
        description: 'Owner contribution received',
        debit: amountCents,
        credit: 0,
      },
      {
        accountId: ownerCoA._id,
        scopeType: 'Company',
        scopeId: null,
        unitId: null,
        description: `Owner contribution (${formatUsd(amountCents)})`,
        debit: 0,
        credit: amountCents,
      },
    ],
    status: 'Posted',
    createdByUserId: new Types.ObjectId(ctx.userId),
  });

  ocr.receivedAmount = (ocr.receivedAmount ?? 0) + amountCents;
  if (ocr.receivedAmount >= ocr.requestedAmount && ocr.status !== 'Completed') {
    ocr.status = 'Completed';
  } else if (ocr.status === 'New') {
    ocr.status = 'In progress';
  }
  await ocr.save();

  await logActivity({
    orgId: ctx.orgId,
    parentType: 'OwnerContributionRequest',
    parentId: ocr._id,
    eventType: 'Owner contribution payment recorded',
    actorUserId: ctx.userId,
    payload: {
      amountCents,
      journalEntryId: String(je._id),
      newStatus: ocr.status,
    },
  });

  return NextResponse.json({
    ok: true,
    receivedAmount: ocr.receivedAmount,
    status: ocr.status,
    journalEntryId: String(je._id),
  });
}
