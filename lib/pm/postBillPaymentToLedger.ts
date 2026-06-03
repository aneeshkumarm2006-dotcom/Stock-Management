// postBillPaymentToLedger — invoked when a BillPayment is recorded.
// Builds a JE: debit A/P (clearing the Bill), credit BankAccount cash CoA.
// Also rolls up Bill.status to `Paid` or `Partially paid`.
import { Types } from 'mongoose';
import { ChartOfAccount } from '@/lib/db/models/pm/ChartOfAccount';
import { JournalEntry } from '@/lib/db/models/pm/JournalEntry';
import { BankAccount } from '@/lib/db/models/pm/BankAccount';
import { Bill } from '@/lib/db/models/pm/Bill';
import { BillPayment } from '@/lib/db/models/pm/BillPayment';
import { assertWriteAllowed, LockedPeriodError } from '@/lib/pm/lockedPeriod';
import type { PmContext } from '@/lib/auth/getCurrentUser';

export interface PostBillPaymentToLedgerInput {
  orgId: string;
  ctx: PmContext;
  billId: Types.ObjectId;
  bankAccountId: Types.ObjectId | null;
  /** Cents. */
  amount: number;
  paidDate: Date;
}

export interface PostBillPaymentToLedgerResult {
  journalEntryId: Types.ObjectId;
  newBillStatus: string;
}

async function resolveBankCashAccountId(
  orgObjectId: Types.ObjectId,
  bankAccountId: Types.ObjectId | null,
): Promise<Types.ObjectId | null> {
  if (bankAccountId) {
    const bank = await BankAccount.findOne({
      _id: bankAccountId,
      organizationId: orgObjectId,
    }).lean<{ chartOfAccountId?: Types.ObjectId | null } | null>();
    if (bank?.chartOfAccountId) return bank.chartOfAccountId;
  }
  const fallback = await ChartOfAccount.findOne({
    organizationId: orgObjectId,
    defaultFor: 'Operating Cash',
    active: true,
  }).lean<{ _id: Types.ObjectId } | null>();
  return fallback ? fallback._id : null;
}

export async function postBillPaymentToLedger(
  input: PostBillPaymentToLedgerInput,
): Promise<PostBillPaymentToLedgerResult> {
  const orgObjectId = new Types.ObjectId(input.orgId);
  const bill = await Bill.findOne({
    _id: input.billId,
    organizationId: orgObjectId,
  });
  if (!bill) throw new Error('Bill not found.');
  if (bill.status === 'Voided') {
    throw new Error('Cannot pay a voided bill.');
  }

  await assertWriteAllowed({
    orgId: input.orgId,
    txnDate: input.paidDate,
    scopePropertyId:
      bill.scope?.type === 'Property' && bill.scope.id
        ? String(bill.scope.id)
        : null,
    ctx: input.ctx,
  });

  const ap = await ChartOfAccount.findOne({
    organizationId: orgObjectId,
    defaultFor: 'Accounts Payable',
  }).lean<{ _id: Types.ObjectId } | null>();
  if (!ap) {
    throw new Error('No Accounts Payable CoA configured for this org.');
  }

  const cashCoA = await resolveBankCashAccountId(
    orgObjectId,
    input.bankAccountId,
  );
  if (!cashCoA) {
    throw new Error(
      'Bank account has no linked Chart of Accounts row and no Operating Cash default exists.',
    );
  }

  const scopeType: 'Property' | 'Company' =
    bill.scope?.type === 'Property' && bill.scope.id ? 'Property' : 'Company';
  const scopeId =
    scopeType === 'Property' && bill.scope.id
      ? new Types.ObjectId(String(bill.scope.id))
      : null;

  const je = await JournalEntry.create({
    organizationId: orgObjectId,
    date: input.paidDate,
    scopeType,
    scopeId,
    memo: `Bill payment — ${String(bill._id).slice(-6)}`,
    attachmentFileId: null,
    lines: [
      {
        accountId: ap._id,
        scopeType,
        scopeId,
        unitId: null,
        description: 'A/P clearing',
        debit: input.amount,
        credit: 0,
      },
      {
        accountId: cashCoA,
        scopeType,
        scopeId,
        unitId: null,
        description: 'Bank cash out',
        debit: 0,
        credit: input.amount,
      },
    ],
    status: 'Posted',
    createdByUserId: new Types.ObjectId(input.ctx.userId),
  });

  // Roll up Bill.status based on sum of all (non-voided) payments.
  const paidAgg = await BillPayment.aggregate<{ _id: null; total: number }>([
    {
      $match: {
        organizationId: orgObjectId,
        billId: bill._id,
      },
    },
    { $group: { _id: null, total: { $sum: '$amount' } } },
  ]);
  // The current BillPayment row is created by the caller BEFORE this function
  // runs (see app/api/pm/bill-payments/route.ts: BillPayment.create → then
  // postBillPaymentToLedger), so it is ALREADY part of this aggregate. Do not
  // add input.amount again or the current payment is double-counted.
  const totalPaid = paidAgg[0]?.total ?? 0;

  let newStatus = bill.status;
  if (totalPaid >= bill.amount) {
    newStatus = 'Paid';
    bill.paidDate = input.paidDate;
  } else if (totalPaid > 0) {
    newStatus = 'Partially paid';
  }
  if (newStatus !== bill.status) {
    bill.status = newStatus as typeof bill.status;
    await bill.save();
  }

  return { journalEntryId: je._id, newBillStatus: newStatus };
}

export { LockedPeriodError };
