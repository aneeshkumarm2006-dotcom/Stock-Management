// CSV import of positions. Header (PDR §5.7):
//   ticker,exchange,quantity,avgBuyPrice,currency,buyDate
// Every row is validated independently; valid rows are committed and invalid
// rows are returned in a row-level error report (PDR §5.7, §11) — a single bad
// row never blocks the rest. Body is the raw CSV text.
// Refs: PDR.md §5.7, §6 (Position), §11.
import { NextResponse } from 'next/server';
import Papa from 'papaparse';
import { z } from 'zod';
import { connectToDatabase } from '@/lib/db/mongoose';
import { Position } from '@/lib/db/models/Position';
import {
  getCurrentUserId,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';

export const runtime = 'nodejs';

const REQUIRED_HEADER = [
  'ticker',
  'exchange',
  'quantity',
  'avgBuyPrice',
  'currency',
];

const emptyToUndefined = (v: unknown) =>
  typeof v === 'string' && v.trim() === '' ? undefined : v;

const rowSchema = z.object({
  ticker: z.string().trim().toUpperCase().min(1, 'Ticker is required').max(12),
  exchange: z.preprocess(
    (v) => (typeof v === 'string' ? v.trim().toUpperCase() : v),
    z.enum(['NYSE', 'NASDAQ', 'TSX']),
  ),
  quantity: z.coerce.number().positive('Quantity must be greater than 0'),
  avgBuyPrice: z.coerce
    .number()
    .min(0, 'Average buy price cannot be negative'),
  currency: z.preprocess(
    (v) => (typeof v === 'string' ? v.trim().toUpperCase() : v),
    z.enum(['USD', 'CAD']),
  ),
  buyDate: z.preprocess(
    emptyToUndefined,
    z.coerce.date().optional(),
  ),
});

interface RowError {
  row: number; // 1-based data row (excludes the header)
  message: string;
}

export async function POST(request: Request) {
  const userId = await getCurrentUserId();
  if (!userId) return unauthorizedResponse();

  const text = await request.text();
  if (!text.trim()) {
    return NextResponse.json({ error: 'Empty CSV body' }, { status: 400 });
  }

  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });

  const headers = parsed.meta.fields ?? [];
  const missing = REQUIRED_HEADER.filter((h) => !headers.includes(h));
  if (missing.length > 0) {
    return NextResponse.json(
      { error: `CSV missing required column(s): ${missing.join(', ')}` },
      { status: 400 },
    );
  }

  const errors: RowError[] = [];
  const valid: Array<{
    userId: string;
    ticker: string;
    exchange: 'NYSE' | 'NASDAQ' | 'TSX';
    quantity: number;
    avgBuyPrice: number;
    currency: 'USD' | 'CAD';
    buyDate?: Date;
  }> = [];

  parsed.data.forEach((raw, i) => {
    const result = rowSchema.safeParse(raw);
    if (!result.success) {
      const msg = result.error.issues
        .map((iss) => `${iss.path.join('.') || 'row'}: ${iss.message}`)
        .join('; ');
      errors.push({ row: i + 1, message: msg });
      return;
    }
    valid.push({ userId, ...result.data });
  });

  let committed = 0;
  if (valid.length > 0) {
    await connectToDatabase();
    const inserted = await Position.insertMany(valid, { ordered: false });
    committed = inserted.length;
  }

  return NextResponse.json(
    {
      committed,
      failed: errors.length,
      total: parsed.data.length,
      errors,
    },
    { status: errors.length > 0 && committed === 0 ? 422 : 200 },
  );
}
