// GET /api/pm/bank-feed-transactions — list bank-feed rows (PDR §3.27b,
// DECISIONS.md [G-S-33]). Filter by bankAccountId + status.
//
// Each Unmatched row carries a `suggestions[]` array of journal lines
// the wizard offers as auto-match candidates (same |amount| within ±2
// days). When the row has no suggestions, the user can match manually
// via POST /[id]/match.
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { BankFeedTransaction } from '@/lib/db/models/pm/BankFeedTransaction';
import { BankAccount } from '@/lib/db/models/pm/BankAccount';
import { JournalEntry } from '@/lib/db/models/pm/JournalEntry';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';

export const runtime = 'nodejs';

interface BftLeanLike {
  _id: Types.ObjectId;
  bankAccountId: Types.ObjectId;
  source: string;
  txnDate: Date;
  description: string;
  amountCents: number;
  status: string;
  externalRef?: string | null;
  matchedJournalLine?: {
    journalEntryId: Types.ObjectId;
    lineId: Types.ObjectId;
  } | null;
}

interface JeLeanLike {
  _id: Types.ObjectId;
  date: Date;
  memo?: string;
  lines: Array<{
    _id: Types.ObjectId;
    accountId: Types.ObjectId;
    debit: number;
    credit: number;
  }>;
}

export async function GET(request: Request) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();

  const { searchParams } = new URL(request.url);
  const bankAccountId = searchParams.get('bankAccountId');
  const status = searchParams.get('status');

  await connectToDatabase();
  const orgObjectId = new Types.ObjectId(ctx.orgId);
  const filter: Record<string, unknown> = {
    organizationId: orgObjectId,
  };
  if (bankAccountId && Types.ObjectId.isValid(bankAccountId)) {
    filter.bankAccountId = new Types.ObjectId(bankAccountId);
  }
  if (status) filter.status = status;

  const rows = await BankFeedTransaction.find(filter)
    .sort({ txnDate: -1 })
    .lean<BftLeanLike[]>();

  // Suggest auto-matches for Unmatched rows only.
  const unmatched = rows.filter((r) => r.status === 'Unmatched');
  const suggestionsByBft = new Map<
    string,
    Array<{ journalEntryId: string; lineId: string; memo: string; date: Date; debit: number; credit: number }>
  >();

  if (unmatched.length > 0 && bankAccountId && Types.ObjectId.isValid(bankAccountId)) {
    const bank = await BankAccount.findOne(
      { _id: new Types.ObjectId(bankAccountId), organizationId: orgObjectId },
      { chartOfAccountId: 1 },
    ).lean<{ chartOfAccountId?: Types.ObjectId | null } | null>();
    if (bank?.chartOfAccountId) {
      // Pull ± 30 days of JEs on this account (one shot, broad window).
      const oldest = new Date(
        Math.min(...unmatched.map((r) => r.txnDate.getTime())) -
          30 * 24 * 60 * 60_000,
      );
      const newest = new Date(
        Math.max(...unmatched.map((r) => r.txnDate.getTime())) +
          30 * 24 * 60 * 60_000,
      );
      const jes = await JournalEntry.find({
        organizationId: orgObjectId,
        status: 'Posted',
        date: { $gte: oldest, $lte: newest },
        'lines.accountId': bank.chartOfAccountId,
      })
        .select('date memo lines')
        .lean<JeLeanLike[]>();

      for (const bft of unmatched) {
        const wanted = Math.abs(bft.amountCents);
        const matches: Array<{
          journalEntryId: string;
          lineId: string;
          memo: string;
          date: Date;
          debit: number;
          credit: number;
        }> = [];
        for (const je of jes) {
          const daysDiff = Math.abs(
            (je.date.getTime() - bft.txnDate.getTime()) / 86_400_000,
          );
          if (daysDiff > 2) continue;
          for (const line of je.lines) {
            if (String(line.accountId) !== String(bank.chartOfAccountId)) {
              continue;
            }
            const net = (line.debit ?? 0) - (line.credit ?? 0);
            if (Math.abs(net) === wanted) {
              matches.push({
                journalEntryId: String(je._id),
                lineId: String(line._id),
                memo: je.memo ?? '',
                date: je.date,
                debit: line.debit ?? 0,
                credit: line.credit ?? 0,
              });
            }
          }
        }
        if (matches.length > 0) {
          suggestionsByBft.set(String(bft._id), matches.slice(0, 5));
        }
      }
    }
  }

  return NextResponse.json(
    rows.map((r) => ({
      id: String(r._id),
      bankAccountId: String(r.bankAccountId),
      source: r.source,
      txnDate: r.txnDate,
      description: r.description,
      amountCents: r.amountCents,
      status: r.status,
      externalRef: r.externalRef ?? null,
      matchedJournalLine: r.matchedJournalLine
        ? {
            journalEntryId: String(r.matchedJournalLine.journalEntryId),
            lineId: String(r.matchedJournalLine.lineId),
          }
        : null,
      suggestions: suggestionsByBft.get(String(r._id)) ?? [],
    })),
  );
}
