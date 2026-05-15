// CSV export of the current user's positions. Header matches the import
// contract exactly so an export round-trips back through /api/import.
// Refs: PDR.md §5.7, §11.
import { NextResponse } from 'next/server';
import Papa from 'papaparse';
import { connectToDatabase } from '@/lib/db/mongoose';
import { Position } from '@/lib/db/models/Position';
import {
  getCurrentUserId,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';

export const runtime = 'nodejs';

const HEADER = [
  'ticker',
  'exchange',
  'quantity',
  'avgBuyPrice',
  'currency',
  'buyDate',
] as const;

export async function GET() {
  const userId = await getCurrentUserId();
  if (!userId) return unauthorizedResponse();

  await connectToDatabase();
  const positions = await Position.find({ userId })
    .sort({ ticker: 1 })
    .lean();

  const rows = positions.map((p) => ({
    ticker: p.ticker,
    exchange: p.exchange,
    quantity: p.quantity,
    avgBuyPrice: p.avgBuyPrice,
    currency: p.currency,
    buyDate: p.buyDate
      ? new Date(p.buyDate).toISOString().slice(0, 10)
      : '',
  }));

  const csv = Papa.unparse(
    { fields: [...HEADER], data: rows },
    { newline: '\n' },
  );

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="positions.csv"',
    },
  });
}
