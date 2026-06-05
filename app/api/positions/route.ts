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
import { Company } from '@/lib/db/models/Company';
import {
  getCurrentUserId,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { getProfile } from '@/lib/api-clients/finnhub';

// Optional "held-by" company. An empty string or null clears it; a value must
// be a 24-char hex ObjectId (ownership is verified against the user's
// companies before it is stored).
const companyIdSchema = z
  .preprocess(
    (v) => (v === '' || v === null || v === undefined ? null : v),
    z.union([z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid company'), z.null()]),
  )
  .optional();

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
  companyId: companyIdSchema,
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

  // One batched Company join (id → name) so the holdings table can show the
  // "held-by" column without a request per row. Scoped to userId so a stale or
  // foreign companyId resolves to a null name rather than leaking another user.
  const companyIds = Array.from(
    new Set(
      positions
        .map((p) => p.companyId)
        .filter((c): c is NonNullable<typeof c> => Boolean(c))
        .map(String),
    ),
  );
  const companyDocs = companyIds.length
    ? await Company.find({ _id: { $in: companyIds }, userId })
        .select('name')
        .lean()
    : [];
  const companyNameById = new Map(
    companyDocs.map((c) => [String(c._id), c.name]),
  );

  const enriched = positions.map((p) => {
    const meta = metaByKey.get(`${p.ticker}:${p.exchange}`);
    const companyId = p.companyId ? String(p.companyId) : null;
    return {
      id: String(p._id),
      ticker: p.ticker,
      exchange: p.exchange,
      quantity: p.quantity,
      avgBuyPrice: p.avgBuyPrice,
      currency: p.currency,
      buyDate: p.buyDate ?? null,
      companyId,
      companyName: companyId ? companyNameById.get(companyId) ?? null : null,
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
  const companyId = parsed.data.companyId ?? null;

  await connectToDatabase();

  // Verify the held-by company belongs to this user before storing the ref.
  if (companyId) {
    const owned = await Company.countDocuments({ _id: companyId, userId });
    if (owned === 0) {
      return NextResponse.json({ error: 'Invalid company' }, { status: 400 });
    }
  }

  const created = await Position.create({
    userId,
    ticker,
    exchange,
    quantity,
    avgBuyPrice,
    currency,
    buyDate,
    companyId,
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
      companyId: created.companyId ? String(created.companyId) : null,
      createdAt: created.createdAt,
      updatedAt: created.updatedAt,
    },
    { status: 201 },
  );
}
