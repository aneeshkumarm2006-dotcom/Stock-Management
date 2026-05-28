// Positions collection route — list (GET) and create (POST) the signed-in
// user's holdings. Every query is scoped to the session-derived userId; the
// client-supplied id is never trusted (PDR §12, defense-in-depth vs IDOR).
// On create we fire an async Finnhub metadata fetch (PDR §5.1).
// Refs: PDR.md §5.1, §5.3, §6 (Position), §11; Tech_Stack.md §Folder Structure.
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { connectToDatabase } from '@/lib/db/mongoose';
import { Position } from '@/lib/db/models/Position';
import { StockMetadata } from '@/lib/db/models/StockMetadata';
import {
  getCurrentUserId,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { getProfile } from '@/lib/api-clients/finnhub';

// Mongoose needs the Node runtime (not Edge).
export const runtime = 'nodejs';

// `exchange` accepts any code the Twelve Data symbol search returns (LSE,
// HKEX, NSE, ASX, XETRA, …) and `currency` accepts any ISO-4217 code from
// the Exchange Rate API's conversion table. Length caps prevent free-text
// abuse; uppercase is enforced so the unique index matches.
const createSchema = z.object({
  ticker: z.string().trim().toUpperCase().min(1, 'Ticker is required').max(20),
  exchange: z
    .string()
    .trim()
    .toUpperCase()
    .min(1, 'Exchange is required')
    .max(32, 'Exchange code is too long'),
  quantity: z.number().positive('Quantity must be greater than 0'),
  avgBuyPrice: z.number().min(0, 'Average buy price cannot be negative'),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, 'Currency must be a 3-letter ISO code'),
  buyDate: z.coerce.date().optional(),
});

/** GET /api/positions — the user's holdings, enriched with cached metadata. */
export async function GET() {
  const userId = await getCurrentUserId();
  if (!userId) return unauthorizedResponse();

  await connectToDatabase();
  const positions = await Position.find({ userId })
    .sort({ createdAt: -1 })
    .lean();

  // One batched StockMetadata join (logo/name/sector) so the portfolio table
  // does not have to issue one profile request per row.
  const keys = positions.map((p) => ({
    ticker: p.ticker,
    exchange: p.exchange,
  }));
  const metaDocs = keys.length
    ? await StockMetadata.find({ $or: keys }).lean()
    : [];
  const metaByKey = new Map(
    metaDocs.map((m) => [`${m.ticker}:${m.exchange}`, m]),
  );

  const enriched = positions.map((p) => {
    const meta = metaByKey.get(`${p.ticker}:${p.exchange}`);
    return {
      id: String(p._id),
      ticker: p.ticker,
      exchange: p.exchange,
      quantity: p.quantity,
      avgBuyPrice: p.avgBuyPrice,
      currency: p.currency,
      buyDate: p.buyDate ?? null,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      metadata: meta
        ? {
            name: meta.name ?? null,
            logo: meta.logo ?? null,
            sector: meta.sector ?? null,
            industry: meta.industry ?? null,
            country: meta.country ?? null,
          }
        : null,
    };
  });

  return NextResponse.json({ positions: enriched });
}

/** POST /api/positions — create a holding for the current user. */
export async function POST(request: Request) {
  const userId = await getCurrentUserId();
  if (!userId) return unauthorizedResponse();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const { ticker, exchange, quantity, avgBuyPrice, currency, buyDate } =
    parsed.data;

  await connectToDatabase();
  const created = await Position.create({
    userId,
    ticker,
    exchange,
    quantity,
    avgBuyPrice,
    currency,
    buyDate,
  });

  // Fire-and-forget company metadata fetch (PDR §5.1). It is cached globally
  // (StockMetadata, 7d TTL) and also lazily fetched by the stock-detail page,
  // so a dropped serverless background task self-heals on the next read.
  void getProfile(ticker, exchange).catch((e: unknown) => {
    console.error('positions: async metadata fetch failed', ticker, e);
  });

  return NextResponse.json(
    {
      id: String(created._id),
      ticker: created.ticker,
      exchange: created.exchange,
      quantity: created.quantity,
      avgBuyPrice: created.avgBuyPrice,
      currency: created.currency,
      buyDate: created.buyDate ?? null,
      createdAt: created.createdAt,
      updatedAt: created.updatedAt,
    },
    { status: 201 },
  );
}
