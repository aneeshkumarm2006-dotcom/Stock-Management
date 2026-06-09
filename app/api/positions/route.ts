// Positions collection route — list (GET) and create (POST) the signed-in
// user's holdings. Every query is scoped to the session-derived userId; the
// client-supplied id is never trusted (PDR §12, defense-in-depth vs IDOR).
// On create we fire an async Finnhub metadata fetch (PDR §5.1).
// Refs: PDR.md §5.1, §5.3, §6 (Position), §11; Tech_Stack.md §Folder Structure.
import { NextResponse } from 'next/server';
import { connectToDatabase } from '@/lib/db/mongoose';
import { Position } from '@/lib/db/models/Position';
import { StockMetadata } from '@/lib/db/models/StockMetadata';
import { Company } from '@/lib/db/models/Company';
import {
  getCurrentUserId,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { getProfile } from '@/lib/api-clients/finnhub';
import { createHoldingSchema, serializeHolding } from '@/lib/validation/holding';

// Mongoose needs the Node runtime (not Edge).
export const runtime = 'nodejs';

/** GET /api/positions — the user's holdings, enriched with cached metadata. */
export async function GET() {
  const userId = await getCurrentUserId();
  if (!userId) return unauthorizedResponse();

  await connectToDatabase();
  const positions = await Position.find({ userId })
    .sort({ createdAt: -1 })
    .lean();

  // One batched StockMetadata join (logo/name/sector) so the portfolio table
  // does not have to issue one profile request per row. Only equities carry a
  // ticker/exchange — skip the rest so we never query (undefined, undefined).
  const keys = positions
    .filter((p) => (p.assetType ?? 'EQUITY') === 'EQUITY' && p.ticker && p.exchange)
    .map((p) => ({ ticker: p.ticker, exchange: p.exchange }));
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
    const assetType = p.assetType ?? 'EQUITY';
    const meta =
      assetType === 'EQUITY'
        ? metaByKey.get(`${p.ticker}:${p.exchange}`)
        : undefined;
    const companyId = p.companyId ? String(p.companyId) : null;
    return {
      id: String(p._id),
      assetType,
      ticker: p.ticker ?? null,
      exchange: p.exchange ?? null,
      quantity: p.quantity ?? null,
      avgBuyPrice: p.avgBuyPrice ?? null,
      currency: p.currency,
      buyDate: p.buyDate ?? null,
      companyId,
      companyName: companyId ? companyNameById.get(companyId) ?? null : null,
      // Non-equity fields (null on equities).
      label: p.label ?? null,
      institution: p.institution ?? null,
      principal: p.principal ?? null,
      startDate: p.startDate ?? null,
      maturityDate: p.maturityDate ?? null,
      interestRate: p.interestRate ?? null,
      payoutFrequency: p.payoutFrequency ?? null,
      costBasis: p.costBasis ?? null,
      currentValue: p.currentValue ?? null,
      valueAsOf: p.valueAsOf ?? null,
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

  const parsed = createHoldingSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const data = parsed.data;
  const companyId = data.companyId ?? null;

  await connectToDatabase();

  // Verify the held-by company belongs to this user before storing the ref.
  if (companyId) {
    const owned = await Company.countDocuments({ _id: companyId, userId });
    if (owned === 0) {
      return NextResponse.json({ error: 'Invalid company' }, { status: 400 });
    }
  }

  // Build the per-type create payload. The discriminated union guarantees the
  // correct fields are present for each assetType.
  const created = await Position.create({ ...data, userId, companyId });

  // Equities get an async company-profile fetch (PDR §5.1) — cached globally
  // (StockMetadata, 7d TTL) and lazily re-fetched by the stock-detail page, so
  // a dropped serverless background task self-heals on the next read. Other
  // asset types have no ticker, so there is nothing to fetch.
  if (data.assetType === 'EQUITY') {
    void getProfile(data.ticker, data.exchange).catch((e: unknown) => {
      console.error('positions: async metadata fetch failed', data.ticker, e);
    });
  }

  return NextResponse.json(serializeHolding(created), { status: 201 });
}
