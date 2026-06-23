/**
 * One-shot migration: rename the Bill `dueDate` field to `invoiceDate`.
 *
 * The Bill model was reworked so the vendor-bill date is captured and labelled
 * as the **invoice date** rather than a payment due date. New code reads/writes
 * `invoiceDate`, but historical `pm_bills` documents still carry `dueDate`.
 * This script renames the field in place so existing bills keep their date
 * under the new name (and satisfy the now-required `invoiceDate`).
 *
 * Scope: ONLY the `pm_bills` collection. The `dueDate` field on Task,
 * WorkOrder, Project, Lease, DraftLease, and OwnerContributionRequest is a
 * different concept and is intentionally left untouched.
 *
 * Idempotent: once renamed a document no longer matches `dueDate: {$exists}`,
 * so re-running reports 0 rows. Runs on the raw collection to bypass Mongoose
 * validation/hooks.
 *
 * Run from `site/`:
 *   npx --yes tsx scripts/rename-bill-duedate-to-invoicedate.ts --dry-run
 *   npx --yes tsx scripts/rename-bill-duedate-to-invoicedate.ts
 */
import dns from 'node:dns';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import mongoose from 'mongoose';
import { connectToDatabase } from '../lib/db/mongoose';
import { Bill } from '../lib/db/models/pm/Bill';

function loadEnvLocal() {
  try {
    for (const line of readFileSync(resolve('.env.local'), 'utf8').split(
      /\r?\n/,
    )) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && m[1] && process.env[m[1]] === undefined) {
        process.env[m[1]] = m[2];
      }
    }
  } catch {
    // .env.local optional when running in CI
  }
}

// Index that referenced the old field name; safe to drop once the field is
// gone (Mongoose has created the invoiceDate-based replacement from the schema).
const STALE_INDEX = 'organizationId_1_status_1_dueDate_1';

async function main() {
  loadEnvLocal();
  const dryRun = process.argv.includes('--dry-run');

  // Windows/Node quirk: the bundled c-ares resolver can default to a dead
  // 127.0.0.1 DNS server and refuse SRV lookups (mongodb+srv://), even when
  // the OS resolver works. Allow overriding the resolver for this run via
  // MONGODB_DNS_SERVERS (comma-separated) without touching system DNS. No-op
  // when unset — so CI and normal machines are unaffected.
  if (process.env.MONGODB_DNS_SERVERS) {
    dns.setServers(
      process.env.MONGODB_DNS_SERVERS.split(',').map((s) => s.trim()),
    );
  }

  await connectToDatabase();
  console.log(`✓ connected to Atlas${dryRun ? ' (dry-run)' : ''}`);

  const filter = { dueDate: { $exists: true } };
  const matchCount = await Bill.collection.countDocuments(filter);

  if (dryRun) {
    console.log(`Would rename dueDate → invoiceDate on ${matchCount} bill(s).`);
    await mongoose.disconnect();
    return;
  }

  const res = await Bill.collection.updateMany(filter, {
    $rename: { dueDate: 'invoiceDate' },
  });
  console.log(
    `Renamed dueDate → invoiceDate on ${res.modifiedCount} bill(s).`,
  );

  // Drop the now-orphaned index (no-op if it was never created or already gone).
  try {
    await Bill.collection.dropIndex(STALE_INDEX);
    console.log(`Dropped stale index ${STALE_INDEX}.`);
  } catch {
    console.log(`Stale index ${STALE_INDEX} not present — nothing to drop.`);
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exitCode = 1;
});
