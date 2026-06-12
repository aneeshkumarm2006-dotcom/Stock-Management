// Singleton cached Mongoose connection, safe across Next.js hot reloads.
// Refs: Tech_Stack.md §Database (Connection: global._mongoose).
import mongoose from 'mongoose';

interface MongooseCache {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
}

declare global {
  // eslint-disable-next-line no-var
  var _mongoose: MongooseCache | undefined;
}

const cached: MongooseCache = global._mongoose ?? { conn: null, promise: null };

if (!global._mongoose) {
  global._mongoose = cached;
}

/**
 * Per-process connection-pool cap. On Vercel every concurrent serverless
 * instance is its own process with its own pool, so the cluster's real ceiling
 * is `maxPoolSize × (warm instances)`. The driver default of 100 means just a
 * handful of warm instances exhaust the Atlas Flex 500-connection cap
 * (DB_CONNECTION_ISSUE.md). Keep it small and overridable via env.
 */
const MAX_POOL_SIZE = (() => {
  const n = Number(process.env.MONGODB_MAX_POOL_SIZE);
  return Number.isFinite(n) && n > 0 ? n : 5;
})();

/**
 * Connect to MongoDB Atlas using a process-global cached connection so that
 * Next.js dev hot reloads and serverless invocations reuse one socket pool
 * instead of opening a new connection per request/reload.
 */
export async function connectToDatabase(): Promise<typeof mongoose> {
  if (cached.conn) {
    return cached.conn;
  }

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI is not defined in the environment.');
  }

  if (!cached.promise) {
    cached.promise = mongoose.connect(uri, {
      bufferCommands: false,
      // Cap the per-process pool so warm serverless instances can't pile up
      // sockets past the Atlas connection cap (DB_CONNECTION_ISSUE.md).
      maxPoolSize: MAX_POOL_SIZE,
      // Let warm-but-idle instances release sockets back to the cluster — the
      // "492/500 connections at ~0.6 reads/s" signature is idle pools, not load.
      minPoolSize: 0,
      maxIdleTimeMS: 30_000,
      // Fail fast instead of holding an invocation (and its pool) open while the
      // cluster is unreachable.
      serverSelectionTimeoutMS: 10_000,
    });
  }

  try {
    cached.conn = await cached.promise;
  } catch (err) {
    cached.promise = null;
    throw err;
  }

  return cached.conn;
}

export default connectToDatabase;
