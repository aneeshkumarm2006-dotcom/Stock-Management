/**
 * Stage 2 scratch verification (not part of the app runtime).
 * Connects to Atlas, creates a User + Position, reads the Position back,
 * syncs + prints indexes for every model, then removes the test docs.
 *
 * Run from `site/`:  npx --yes tsx scripts/verify-db.ts
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import mongoose from 'mongoose';
import { connectToDatabase } from '../lib/db/mongoose';
import User from '../lib/db/models/User';
import Position from '../lib/db/models/Position';
import StockMetadata from '../lib/db/models/StockMetadata';
import PriceCache from '../lib/db/models/PriceCache';
import HistoricalCache from '../lib/db/models/HistoricalCache';
import MarketDataCache from '../lib/db/models/MarketDataCache';
import Settings from '../lib/db/models/Settings';
import ApiUsage from '../lib/db/models/ApiUsage';

function loadEnvLocal() {
  for (const line of readFileSync(resolve('.env.local'), 'utf8').split(
    /\r?\n/,
  )) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && m[1] && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2];
    }
  }
}

async function main() {
  loadEnvLocal();

  await connectToDatabase();
  console.log('✓ connected to Atlas');

  const models = [
    User,
    Position,
    StockMetadata,
    PriceCache,
    HistoricalCache,
    MarketDataCache,
    Settings,
    ApiUsage,
  ];

  for (const m of models) {
    await m.syncIndexes();
    const idx = await m.collection.indexes();
    console.log(
      `  ${m.modelName} (${m.collection.collectionName}): ` +
        idx.map((i) => `${i.name}${i.unique ? ' [unique]' : ''}`).join(', '),
    );
  }

  const user = await User.create({
    email: `stage2-verify-${Date.now()}@example.com`,
    name: 'Stage 2 Verify',
  });

  const created = await Position.create({
    userId: user._id,
    ticker: 'aapl',
    exchange: 'NASDAQ',
    quantity: 10,
    avgBuyPrice: 150.25,
    currency: 'USD',
  });

  const read = await Position.findById(created._id).lean();
  if (!read) throw new Error('Position read-back failed');
  console.log(
    `✓ Position round-trip: ${read.ticker} ${read.exchange} ` +
      `qty=${read.quantity} avg=${read.avgBuyPrice} ` +
      `(ticker uppercased: ${read.ticker === 'AAPL'})`,
  );

  await Position.deleteOne({ _id: created._id });
  await User.deleteOne({ _id: user._id });
  console.log('✓ test docs cleaned up');

  await mongoose.disconnect();
  console.log('✓ done');
}

main().catch((e) => {
  console.error('✗ verification failed:', e);
  process.exitCode = 1;
});
