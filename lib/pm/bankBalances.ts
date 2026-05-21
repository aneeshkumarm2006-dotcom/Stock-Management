// Derived bank-account balance + undeposited-funds roll-ups (BR-AC-7).
//
// `balance` is computed by summing (debit − credit) on every Posted JE line
// posted to the bank's underlying CoA cash row. Voided JEs are excluded; the
// reversing JE they spawn is itself Posted and nets the original out.
//
// `undepositedFunds` is true when this bank has at least one Posted JE line
// against the org's "Undeposited Funds" default-for CoA row that hasn't yet
// been swept into a Deposit. For Phase 2 MVP we approximate this as
// "≥1 JE line hits the org's Undeposited Funds account whose deposit hasn't
// been matched to a reconciliation" — reconciliation lands Phase 9, so the
// flag effectively reads as "any undeposited-funds activity exists on this
// bank's ledger". Refines later when reconciliation arrives.
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { BankAccount } from '@/lib/db/models/pm/BankAccount';
import { ChartOfAccount } from '@/lib/db/models/pm/ChartOfAccount';
import { JournalEntry } from '@/lib/db/models/pm/JournalEntry';

export interface BankRollup {
  /** Balance in cents (signed). */
  balance: number;
  undepositedFunds: boolean;
}

const ZERO: BankRollup = { balance: 0, undepositedFunds: false };

export async function computeBankRollups(
  orgId: string,
  bankAccountIds: Types.ObjectId[],
): Promise<Map<string, BankRollup>> {
  if (bankAccountIds.length === 0) return new Map();
  await connectToDatabase();
  const orgObjectId = new Types.ObjectId(orgId);

  // Resolve each bank's chartOfAccountId (the CoA cash row driving balance).
  const banks = await BankAccount.find({
    _id: { $in: bankAccountIds },
    organizationId: orgObjectId,
  })
    .select('_id chartOfAccountId')
    .lean();
  const bankToCash = new Map<string, Types.ObjectId | null>(
    banks.map((b) => [String(b._id), b.chartOfAccountId ?? null]),
  );

  const undepositedAccount = await ChartOfAccount.findOne({
    organizationId: orgObjectId,
    defaultFor: 'Undeposited Funds',
  })
    .select('_id')
    .lean();

  const cashAccountIds = Array.from(bankToCash.values()).filter(
    (v): v is Types.ObjectId => Boolean(v),
  );

  // Sum debits/credits per cash account from Posted JEs only.
  const balanceRows: { _id: Types.ObjectId; net: number }[] =
    cashAccountIds.length > 0
      ? await JournalEntry.aggregate([
          { $match: { organizationId: orgObjectId, status: 'Posted' } },
          { $unwind: '$lines' },
          { $match: { 'lines.accountId': { $in: cashAccountIds } } },
          {
            $group: {
              _id: '$lines.accountId',
              net: {
                $sum: { $subtract: ['$lines.debit', '$lines.credit'] },
              },
            },
          },
        ])
      : [];
  const netByCashAccount = new Map<string, number>(
    balanceRows.map((r) => [String(r._id), r.net]),
  );

  // Undeposited-funds activity is org-wide; flag any bank whose ledger
  // includes Posted JE lines against the Undeposited Funds CoA row.
  // (Phase 9 will refine this to "for THIS bank, with no matching Deposit".)
  let undepositedActive = false;
  if (undepositedAccount) {
    undepositedActive = Boolean(
      await JournalEntry.exists({
        organizationId: orgObjectId,
        status: 'Posted',
        'lines.accountId': undepositedAccount._id,
      }),
    );
  }

  const out = new Map<string, BankRollup>();
  for (const bankId of bankAccountIds) {
    const cashAccountId = bankToCash.get(String(bankId));
    if (!cashAccountId) {
      out.set(String(bankId), ZERO);
      continue;
    }
    const net = netByCashAccount.get(String(cashAccountId)) ?? 0;
    out.set(String(bankId), {
      balance: net,
      undepositedFunds: undepositedActive,
    });
  }
  return out;
}
