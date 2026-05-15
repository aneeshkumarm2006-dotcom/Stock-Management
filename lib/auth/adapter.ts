// @auth/mongodb-adapter wired over the shared Mongoose connection so Auth.js
// and our Mongoose models talk to the exact same MongoClient / database.
// Refs: Tech_Stack.md §Database (singleton connection), §Authentication.
import { MongoDBAdapter } from '@auth/mongodb-adapter';
import type { Adapter } from 'next-auth/adapters';
import type { MongoClient } from 'mongodb';
import { connectToDatabase } from '@/lib/db/mongoose';

/**
 * Lazily resolve the underlying native MongoClient from the cached Mongoose
 * connection. Passing a thunk means the connection is only established when the
 * adapter first needs it (e.g. a Google OAuth sign-in), never at module load.
 */
async function getMongoClient(): Promise<MongoClient> {
  const conn = await connectToDatabase();
  // Mongoose bundles its own mongodb; the instance is wire-compatible with the
  // adapter's mongodb peer — cast across the duplicated type identities.
  return conn.connection.getClient() as unknown as MongoClient;
}

export const mongoAdapter: Adapter = MongoDBAdapter(getMongoClient);

export default mongoAdapter;
