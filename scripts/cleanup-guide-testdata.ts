/**
 * Cleanup for the test data created while producing the Property-Management
 * user guide (screenshots run as lisa@ramcodev.com on 2026-07-07).
 *
 * Deletes ONLY these exact records, by _id — nothing else is touched:
 *   - Test tenant "zzGUIDE-TEST DELETE-ME"      6a4c07e13b07e778ae43c316
 *       (already permanently deleted during the demo; this is a safety no-op)
 *   - Renewal draft "Draft #12" (from lease #21) 6a4c09363b07e778ae43c37c
 *   - Any ActivityLogEntry rows whose parentId is one of the above.
 *
 * The source lease #21 (6a31605d6babc655076a50ae) is NOT modified — the
 * renewal only *read* it and seeded a separate DraftLease. Editing its lease
 * modal / term schedule during the demo was cancelled (never saved).
 *
 * Run from `site/`:  npx --yes tsx scripts/cleanup-guide-testdata.ts
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import dns from 'node:dns';
import mongoose, { Types } from 'mongoose';
import { connectToDatabase } from '../lib/db/mongoose';
import { DraftLease } from '../lib/db/models/pm/DraftLease';
import { Lease } from '../lib/db/models/pm/Lease';
import { Tenant } from '../lib/db/models/pm/Tenant';
import { ActivityLogEntry } from '../lib/db/models/pm/ActivityLogEntry';

// Exact IDs of the guide's test data.
const TEST_TENANT_ID = '6a4c07e13b07e778ae43c316';   // "zzGUIDE-TEST DELETE-ME" (deleted during demo)
const RENEWAL_DRAFT_ID = '6a4c09363b07e778ae43c37c'; // renewal draft #12 (from lease #21)

// Timezone-fix verification data (assign test):
const TZFIX_TENANT_ID = '6a4c1c582072933ff33af2c6'; // "zzTZFIX VERIFY"
const TZFIX_LEASE_ID = '6a4c1d192072933ff33af31d';  // lease #38 on unit 803 B (At-will). No JE is posted by assign.

function loadEnvLocal() {
  for (const line of readFileSync(resolve('.env.local'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && m[1] && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

async function main() {
  loadEnvLocal();
  if (process.env.MONGODB_DNS_SERVERS) {
    dns.setServers(process.env.MONGODB_DNS_SERVERS.split(',').map((s) => s.trim()));
  }
  await connectToDatabase();
  console.log('connected');

  const draftId = new Types.ObjectId(RENEWAL_DRAFT_ID);
  const tenantId = new Types.ObjectId(TEST_TENANT_ID);
  const tzTenantId = new Types.ObjectId(TZFIX_TENANT_ID);
  const tzLeaseId = new Types.ObjectId(TZFIX_LEASE_ID);

  const draftRes = await DraftLease.deleteOne({ _id: draftId });
  console.log(`DraftLease ${RENEWAL_DRAFT_ID}: deleted ${draftRes.deletedCount}`);

  const leaseRes = await Lease.deleteOne({ _id: tzLeaseId });
  console.log(`Lease ${TZFIX_LEASE_ID} (unit 803 B): deleted ${leaseRes.deletedCount}`);

  const tenantRes = await Tenant.deleteOne({ _id: tenantId });
  console.log(
    `Tenant ${TEST_TENANT_ID}: deleted ${tenantRes.deletedCount}` +
      (tenantRes.deletedCount === 0 ? ' (already removed during the demo — expected)' : ''),
  );

  const tzTenantRes = await Tenant.deleteOne({ _id: tzTenantId });
  console.log(`Tenant ${TZFIX_TENANT_ID} (assign test): deleted ${tzTenantRes.deletedCount}`);

  const logRes = await ActivityLogEntry.deleteMany({
    parentId: { $in: [draftId, tenantId, tzTenantId, tzLeaseId] },
  });
  console.log(`ActivityLogEntry rows: deleted ${logRes.deletedCount}`);

  await mongoose.disconnect();
  console.log('done — guide test data removed.');
}

main().catch((e) => {
  console.error('cleanup failed:', e);
  process.exitCode = 1;
});
