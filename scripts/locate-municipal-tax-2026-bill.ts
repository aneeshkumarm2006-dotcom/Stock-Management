/**
 * READ-ONLY lookup for Bob's "we can't find this bill in the Bills tab" report.
 *
 * The bill in his screenshot is the ledger entry
 *   4/30/2026 · RAMCO DEV McDonald's 797 Cure Labelle
 *   "Bill — Municipal Tax 2026" · C$32,767.23
 *
 * Prints the Bill document behind that JE — its id, status, memo, vendor and
 * the direct URLs for both the bill and its journal entry — so the answer to
 * "where do we look for it?" is a link rather than a hunt.
 *
 * Writes nothing.
 *
 * Run from `site/`:  npx --yes tsx scripts/locate-municipal-tax-2026-bill.ts
 */
import dns from 'node:dns';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import mongoose, { Types } from 'mongoose';
import { connectToDatabase } from '../lib/db/mongoose';
import { Bill } from '../lib/db/models/pm/Bill';
import { JournalEntry } from '../lib/db/models/pm/JournalEntry';
import { Property } from '../lib/db/models/pm/Property';
import { Vendor } from '../lib/db/models/pm/Vendor';

function loadEnvLocal() {
  try {
    for (const line of readFileSync(resolve('.env.local'), 'utf8').split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && m[1] && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
    }
  } catch {
    /* optional in CI */
  }
}

const money = (cents: number) =>
  `C$${(cents / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

async function main() {
  loadEnvLocal();
  if (process.env.MONGODB_DNS_SERVERS) {
    dns.setServers(process.env.MONGODB_DNS_SERVERS.split(',').map((s) => s.trim()));
  }
  await connectToDatabase();
  console.log('connected (READ-ONLY)\n');

  const bills = await Bill.find({
    memo: { $regex: 'municipal tax 2026', $options: 'i' },
  }).lean<
    Array<{
      _id: Types.ObjectId;
      memo?: string;
      status: string;
      amount: number;
      refNo?: string;
      invoiceDate: Date;
      vendorId?: Types.ObjectId | null;
      scope?: { type: string; id?: Types.ObjectId | null };
      journalEntryId?: Types.ObjectId | null;
    }>
  >();

  console.log(`${bills.length} bill(s) whose memo matches "Municipal Tax 2026":\n`);

  for (const b of bills) {
    const [prop, vendor, je] = await Promise.all([
      b.scope?.id
        ? Property.findById(b.scope.id).select({ propertyName: 1 }).lean<{ propertyName: string } | null>()
        : null,
      b.vendorId
        ? Vendor.findById(b.vendorId).select({ displayName: 1 }).lean<{ displayName: string } | null>()
        : null,
      b.journalEntryId
        ? JournalEntry.findById(b.journalEntryId)
            .select({ date: 1, memo: 1, status: 1 })
            .lean<{ date: Date; memo?: string; status: string } | null>()
        : null,
    ]);

    console.log(`  memo        : ${b.memo ?? '(none)'}`);
    console.log(`  property    : ${prop?.propertyName ?? b.scope?.type ?? 'Company'}`);
    console.log(`  amount      : ${money(b.amount)}`);
    console.log(`  status      : ${b.status}`);
    console.log(`  vendor      : ${vendor?.displayName ?? '(none)'}`);
    console.log(`  ref #       : ${b.refNo || '(none)'}`);
    console.log(`  invoice date: ${b.invoiceDate.toISOString().slice(0, 10)}`);
    if (je) {
      console.log(`  ledger entry: ${je.date.toISOString().slice(0, 10)}  "${je.memo ?? ''}"  [${je.status}]`);
    }
    console.log(`  BILL URL    : /properties/accounting/bills/${String(b._id)}`);
    if (b.journalEntryId) {
      console.log(
        `  LEDGER URL  : /properties/accounting/general-ledger/${String(b.journalEntryId)}`,
      );
    }
    console.log('');
  }

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});
