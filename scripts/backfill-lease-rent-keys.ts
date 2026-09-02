/**
 * Stamps `leaseId` / `leaseChargeKey` / `leasePeriodDate` onto historical rent
 * journal entries, so the unique partial index in
 * lib/db/models/pm/JournalEntry.ts actually covers them.
 *
 * WHY THIS MUST RUN BEFORE THE FIRST CATCH-UP. The index is partial on
 * `leaseId: {$type:'objectId'}`. Every entry written before those fields
 * existed has `leaseId: null` and is therefore EXCLUDED from it — invisible to
 * the database guard. `planLeaseRentCatchUp` also probes by memo, so a catch-up
 * would not double-post today, but that probe is a safety net over a memo
 * format that has already changed once. This makes the guard structural.
 *
 * SCOPE: PRIMARY RENT ONLY. A `recurringCharges[]` accrual cannot be attributed
 * to a specific row from its memo — several rows can share a description — and
 * inventing a key here that the poster would never generate would create the
 * very collision the key exists to prevent. Those entries stay unkeyed and
 * remain covered by the memo probe.
 *
 * COLLISIONS ABORT THE RUN. A unique index does not build when duplicates
 * already exist, and Mongoose reports that failure on the connection's error
 * event rather than at query time — you would ship believing rent was protected
 * when it is not. So this script reports every (lease, period) that already has
 * more than one primary-rent entry and refuses to write until they are
 * resolved.
 *
 * Dry-run by default. Pass --apply to write.
 *   npx --yes tsx scripts/backfill-lease-rent-keys.ts
 *   npx --yes tsx scripts/backfill-lease-rent-keys.ts --apply
 */
import dns from "node:dns";
import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import mongoose, { Types } from "mongoose";
import { connectToDatabase } from "../lib/db/mongoose";
import { JournalEntry } from "../lib/db/models/pm/JournalEntry";
import { Lease } from "../lib/db/models/pm/Lease";
import {
  parseLeaseNumberFromMemo,
  rentChargeMemoMatcher,
} from "../lib/pm/journalMemo";
import { PRIMARY_RENT_KEY } from "../lib/pm/leaseRentCatchUp";

function loadEnvLocal() {
  try {
    const raw = readFileSync(resolvePath(".env.local"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && m[1] && process.env[m[1]] === undefined)
        process.env[m[1]] = m[2];
    }
  } catch {
    /* optional */
  }
}

function arg(name: string): string | null {
  const hit = process.argv.find((a) => a.startsWith("--" + name + "="));
  return hit ? hit.slice(name.length + 3) : null;
}

const APPLY = process.argv.includes("--apply");
const ORG_ID = arg("org");
const dayOf = (d: Date) => d.toISOString().slice(0, 10);

async function main() {
  loadEnvLocal();
  const servers = process.env.MONGODB_DNS_SERVERS;
  if (servers) dns.setServers(servers.split(",").map((s) => s.trim()));
  await connectToDatabase();

  console.log("MODE: " + (APPLY ? "APPLY (writing)" : "DRY RUN (no writes)"));
  console.log("ORG:  " + (ORG_ID ?? "all organizations") + "\n");

  const filter: Record<string, unknown> = {
    leaseId: null,
    memo: /lease #\d+/i,
  };
  if (ORG_ID) filter.organizationId = new Types.ObjectId(ORG_ID);

  const entries = await JournalEntry.find(filter)
    .select({ _id: 1, organizationId: 1, memo: 1, date: 1 })
    .sort({ date: 1 })
    .lean<
      Array<{
        _id: Types.ObjectId;
        organizationId: Types.ObjectId;
        memo?: string;
        date: Date;
      }>
    >();
  console.log("Unkeyed entries mentioning a lease: " + entries.length);

  // lease number -> lease, per org (leaseNumber is unique within an org only).
  const leaseRows = await Lease.find(
    ORG_ID ? { organizationId: new Types.ObjectId(ORG_ID) } : {},
  )
    .select({ _id: 1, organizationId: 1, leaseNumber: 1 })
    .lean<
      Array<{
        _id: Types.ObjectId;
        organizationId: Types.ObjectId;
        leaseNumber: number;
      }>
    >();
  const leaseByOrgNumber = new Map<string, Types.ObjectId>();
  for (const l of leaseRows) {
    leaseByOrgNumber.set(String(l.organizationId) + "|" + l.leaseNumber, l._id);
  }

  const planned: Array<{
    id: Types.ObjectId;
    leaseId: Types.ObjectId;
    period: Date;
    memo: string;
  }> = [];
  let notRent = 0;
  let noLease = 0;

  for (const e of entries) {
    const num = parseLeaseNumberFromMemo(e.memo);
    if (num === null) continue;
    if (!rentChargeMemoMatcher(num).test(e.memo ?? "")) {
      notRent += 1; // move-in, recurring extra, late fee, deposit…
      continue;
    }
    const leaseId = leaseByOrgNumber.get(String(e.organizationId) + "|" + num);
    if (!leaseId) {
      noLease += 1;
      console.log(
        "  ? no lease #" +
          num +
          " in org " +
          String(e.organizationId) +
          " — " +
          (e.memo ?? ""),
      );
      continue;
    }
    const d = new Date(e.date);
    planned.push({
      id: e._id,
      leaseId,
      period: new Date(
        Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
      ),
      memo: e.memo ?? "",
    });
  }

  console.log("  primary-rent entries to key: " + planned.length);
  console.log("  other lease entries (left unkeyed): " + notRent);
  if (noLease > 0) console.log("  unmatched lease numbers: " + noLease);

  // -- collision check ------------------------------------------------------
  // Includes rows that ALREADY carry keys, so a partially-applied run cannot
  // hide a conflict from the second half of the backfill.
  const existing = await JournalEntry.find({
    ...(ORG_ID ? { organizationId: new Types.ObjectId(ORG_ID) } : {}),
    leaseId: { $type: "objectId" },
    leaseChargeKey: PRIMARY_RENT_KEY,
  })
    .select({ _id: 1, organizationId: 1, leaseId: 1, leasePeriodDate: 1 })
    .lean<
      Array<{
        _id: Types.ObjectId;
        organizationId: Types.ObjectId;
        leaseId: Types.ObjectId;
        leasePeriodDate?: Date | null;
      }>
    >();

  const seen = new Map<string, string[]>();
  for (const r of existing) {
    if (!r.leasePeriodDate) continue;
    const k =
      String(r.organizationId) +
      "|" +
      String(r.leaseId) +
      "|" +
      dayOf(new Date(r.leasePeriodDate));
    seen.set(k, [...(seen.get(k) ?? []), String(r._id)]);
  }
  const orgById = new Map(
    entries.map((e) => [String(e._id), e.organizationId]),
  );
  for (const p of planned) {
    const org = orgById.get(String(p.id));
    const k = String(org) + "|" + String(p.leaseId) + "|" + dayOf(p.period);
    seen.set(k, [...(seen.get(k) ?? []), String(p.id)]);
  }
  const collisions = Array.from(seen.entries()).filter(
    ([, ids]) => ids.length > 1,
  );

  if (collisions.length > 0) {
    console.log("\n" + "!".repeat(64));
    console.log(
      collisions.length +
        " (lease, period) pair(s) already carry MORE THAN ONE primary-rent entry.",
    );
    console.log(
      "The unique index cannot build while these exist, and a failed build is\n" +
        "reported on the connection error event — not at query time — so the\n" +
        "guard would silently be absent. Resolve these first (void the extra\n" +
        "entry, or correct its date), then re-run.\n",
    );
    for (const [k, ids] of collisions.slice(0, 40)) {
      const [, leaseId, period] = k.split("|");
      console.log(
        "  lease " + leaseId + "  " + period + "  → " + ids.join(", "),
      );
    }
    if (collisions.length > 40) {
      console.log("  … and " + (collisions.length - 40) + " more");
    }
    process.exitCode = 1;
    return;
  }
  console.log("  no duplicate (lease, period) pairs — the index can build.\n");

  if (!APPLY) {
    for (const p of planned.slice(0, 20)) {
      console.log(
        "  would key " + dayOf(p.period) + "  " + p.memo.slice(0, 60),
      );
    }
    if (planned.length > 20) {
      console.log("  … and " + (planned.length - 20) + " more");
    }
    console.log("\nDry run — nothing was written. Re-run with --apply.");
    return;
  }

  let written = 0;
  for (const p of planned) {
    await JournalEntry.updateOne(
      { _id: p.id },
      {
        $set: {
          leaseId: p.leaseId,
          leaseChargeKey: PRIMARY_RENT_KEY,
          leasePeriodDate: p.period,
        },
      },
    );
    written += 1;
  }
  console.log("Keyed " + written + " entries.");
  console.log(
    "Now run: npx --yes tsx scripts/verify-pm-indexes.ts --collection=pm_journal_entries",
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
