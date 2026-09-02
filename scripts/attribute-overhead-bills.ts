/**
 * Move company-overhead bills out of the legacy "Company (unassigned)" bucket
 * and onto a named CompanyAccount, so they land in that company's column on
 * Financials instead of the catch-all.
 *
 * WHY A SCRIPT AND NOT THE UI. `Property.companyAccountId` and `Bill.scope.id`
 * are independent: assigning a building to a company does not move a single
 * bill, because a bill carries its own scope. The bill modals can now name a
 * company (they could not before), but there is no bulk path and no reason to
 * re-key months of history by hand.
 *
 * IT REFUSES TO GUESS WHICH ACCOUNTS ARE "OVERHEAD". Run with no --accounts and
 * it prints every chart-of-accounts row the legacy bucket actually touches,
 * with totals and sample memos. That table is the answer to "which account is
 * fuel" — this client books it as `Carburant` under `Car – Gas & parking`,
 * which no name-matching rule would have found, and that account also carries
 * parking. `--apply` is refused without an explicit `--accounts` list for
 * exactly that reason: a regex must never be what moves money.
 *
 * THE LEDGER MUST FOLLOW THE BILL. Re-scoping `bill.scope` alone changes
 * nothing on any report — the journal entry keeps the scope it was posted with.
 * Each affected JE is updated IN PLACE via `repostBillJournalEntry`, never
 * void-and-repost: a stray Posted reversal cancels the new entry in both P&L
 * aggregators (see lib/pm/repostBillJournalEntry.ts).
 *
 * IDEMPOTENT BY CONSTRUCTION. The selection predicate is `scope.id: null`, so a
 * bill this script has already moved no longer matches it. There is no
 * "processed" flag to get wrong. The predicate is re-asserted immediately
 * before each write in case of a concurrent edit.
 *
 *   # 1. discover — no company needed, prints the account table
 *   npx --yes tsx scripts/attribute-overhead-bills.ts --org=<id>
 *
 *   # 2. dry-run a concrete plan
 *   npx --yes tsx scripts/attribute-overhead-bills.ts --org=<id> \
 *       --company="Ramco company" --accounts=<id>,<id>,<id>
 *
 *   # 3. write
 *   ... same, plus --apply
 *
 *   # reversal: put named bills back in the legacy bucket
 *   ... --company=none --only=<billId>,<billId> --apply
 */
import dns from "node:dns";
import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import mongoose, { Types } from "mongoose";
import { connectToDatabase } from "../lib/db/mongoose";
import { Bill } from "../lib/db/models/pm/Bill";
import { BillPayment } from "../lib/db/models/pm/BillPayment";
import { ChartOfAccount } from "../lib/db/models/pm/ChartOfAccount";
import { CompanyAccount } from "../lib/db/models/pm/CompanyAccount";
import { JournalEntry } from "../lib/db/models/pm/JournalEntry";
import { LockedPeriodPolicy } from "../lib/db/models/pm/LockedPeriodPolicy";
import { repostBillJournalEntry } from "../lib/pm/repostBillJournalEntry";
import { normalizeScope, toBillScope } from "../lib/pm/scope";
import type { PmContext } from "../lib/auth/getCurrentUser";

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

const ORG_ID = arg("org") ?? "6a15a84e5bac3c1113395eb4";
const APPLY = process.argv.includes("--apply");
const ALLOW_MIXED = process.argv.includes("--allow-mixed");
const COMPANY_ARG = arg("company");
const ACCOUNTS_ARG = arg("accounts");
const ONLY_ARG = arg("only");
const money = (c: number) => "C$" + (c / 100).toFixed(2);
const iso = (d: Date | null | undefined) =>
  d ? new Date(d).toISOString().slice(0, 10) : "(no date)";

async function main() {
  loadEnvLocal();
  const servers = process.env.MONGODB_DNS_SERVERS;
  if (servers) dns.setServers(servers.split(",").map((s) => s.trim()));
  await connectToDatabase();
  const orgObjectId = new Types.ObjectId(ORG_ID);

  console.log("MODE: " + (APPLY ? "APPLY (writing)" : "DRY RUN (no writes)"));
  console.log("ORG:  " + ORG_ID + "\n");

  const companies = await CompanyAccount.find({ organizationId: orgObjectId })
    .select({ _id: 1, name: 1, active: 1 })
    .sort({ name: 1 })
    .lean<Array<{ _id: Types.ObjectId; name: string; active: boolean }>>();

  // `--company=none` is the reversal: back to the legacy bucket, explicitly.
  let targetCompanyId: Types.ObjectId | null = null;
  let targetLabel = "";
  if (COMPANY_ARG && COMPANY_ARG !== "none") {
    const hit = companies.find(
      (c) =>
        String(c._id) === COMPANY_ARG ||
        c.name.toLowerCase() === COMPANY_ARG.toLowerCase(),
    );
    if (!hit) {
      console.log("No company matches --company=" + COMPANY_ARG + ". Known:");
      for (const c of companies)
        console.log("  " + String(c._id) + "  " + c.name);
      return;
    }
    targetCompanyId = hit._id;
    targetLabel = hit.name;
  } else if (COMPANY_ARG === "none") {
    targetLabel = "Company (unassigned) — REVERSAL";
  }

  const onlyIds = ONLY_ARG
    ? new Set(
        ONLY_ARG.split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      )
    : null;

  // The reversal path selects bills already ON the target company, so it cannot
  // use the legacy-bucket predicate. Everything else does.
  const reversing = COMPANY_ARG === "none";
  const selector: Record<string, unknown> = {
    organizationId: orgObjectId,
    "scope.type": "Company",
    status: { $ne: "Voided" },
  };
  if (reversing) {
    if (!onlyIds) {
      console.log("--company=none requires --only=<billId,...>. Refusing to");
      console.log("un-attribute every company-scoped bill in the org.");
      return;
    }
    selector._id = {
      $in: Array.from(onlyIds).map((s) => new Types.ObjectId(s)),
    };
  } else {
    selector["scope.id"] = null;
  }

  const bills = await Bill.find(selector).sort({ invoiceDate: 1 });

  const accounts = await ChartOfAccount.find({ organizationId: orgObjectId })
    .select({ _id: 1, name: 1 })
    .lean<Array<{ _id: Types.ObjectId; name: string }>>();
  const accName = new Map(accounts.map((a) => [String(a._id), a.name]));

  // ---- A. what is actually in there -------------------------------------
  console.log("=== A. Accounts touched by the selected bills ===");
  console.log("  " + bills.length + " bill(s)\n");
  const byAcc = new Map<
    string,
    {
      lines: number;
      cents: number;
      first: Date | null;
      last: Date | null;
      memos: string[];
    }
  >();
  for (const b of bills) {
    for (const l of b.lines ?? []) {
      const k = String(l.accountId);
      const e = byAcc.get(k) ?? {
        lines: 0,
        cents: 0,
        first: null,
        last: null,
        memos: [],
      };
      e.lines += 1;
      e.cents += l.amount ?? 0;
      if (!e.first || b.invoiceDate < e.first) e.first = b.invoiceDate;
      if (!e.last || b.invoiceDate > e.last) e.last = b.invoiceDate;
      if (e.memos.length < 3 && b.memo && !e.memos.includes(b.memo)) {
        e.memos.push(b.memo);
      }
      byAcc.set(k, e);
    }
  }
  for (const [k, v] of Array.from(byAcc.entries()).sort(
    (a, b) => b[1].cents - a[1].cents,
  )) {
    console.log(
      "  " +
        (accName.get(k) ?? k).padEnd(38) +
        String(v.lines).padStart(4) +
        " lines  " +
        money(v.cents).padStart(13) +
        "   " +
        iso(v.first) +
        " .. " +
        iso(v.last),
    );
    console.log("      id: " + k + "   e.g. " + v.memos.join(" / "));
  }
  if (byAcc.size === 0) console.log("  (nothing selected)");

  if (!ACCOUNTS_ARG) {
    console.log(
      "\nNo --accounts given, so this was discovery only. Pick the account ids\n" +
        "above that really are the overhead you mean, then re-run with\n" +
        '  --company="<name>" --accounts=<id>,<id>\n' +
        "Nothing is ever moved on the strength of an account NAME: this client\n" +
        "books fuel as 'Carburant' under 'Car – Gas & parking', which also\n" +
        'carries parking, and there is no account called "Fuel" at all.',
    );
    return;
  }

  const wanted = new Set(
    ACCOUNTS_ARG.split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
  const unknown = Array.from(wanted).filter((id) => !accName.has(id));
  if (unknown.length > 0) {
    console.log("\nUnknown account id(s): " + unknown.join(", "));
    return;
  }
  if (!COMPANY_ARG) {
    console.log("\n--accounts given but no --company. Nothing to do.");
    return;
  }

  console.log("\n=== B. Plan ===");
  console.log("  target: " + targetLabel);
  console.log(
    "  accounts: " +
      Array.from(wanted)
        .map((id) => accName.get(id))
        .join(", ") +
      "\n",
  );

  const policies = await LockedPeriodPolicy.find({
    organizationId: orgObjectId,
    active: true,
  }).lean<Array<{ fromDate?: Date | null; toDate?: Date | null }>>();
  const inLockedPeriod = (d: Date) =>
    policies.some(
      (p) =>
        (!p.fromDate || d >= new Date(p.fromDate)) &&
        (!p.toDate || d <= new Date(p.toDate)),
    );

  const ctx: PmContext = {
    userId: ORG_ID,
    orgId: ORG_ID,
    roles: ["FinancialAdministrator"],
    impersonatedBy: null,
  };

  let moved = 0;
  let skipped = 0;
  let movedCents = 0;
  let paymentsAffected = 0;
  let paymentCents = 0;

  for (const bill of bills) {
    if (onlyIds && !onlyIds.has(String(bill._id))) continue;

    const lines = bill.lines ?? [];
    const hits = lines.filter((l) => wanted.has(String(l.accountId)));
    if (hits.length === 0) continue;

    const label =
      iso(bill.invoiceDate) +
      "  " +
      money(bill.amount).padStart(12) +
      "  " +
      (bill.memo ?? "").slice(0, 44);

    // A bill already carrying per-line overrides is an allocated bill; leave it.
    if (lines.some((l) => l.scopeId)) {
      console.log("  SKIP (already allocated per line)  " + label);
      skipped += 1;
      continue;
    }
    const mixed = hits.length !== lines.length;
    if (mixed && !ALLOW_MIXED) {
      console.log("  SKIP (MIXED — pass --allow-mixed)  " + label);
      console.log(
        "        " +
          lines
            .map(
              (l) =>
                (wanted.has(String(l.accountId)) ? "*" : " ") +
                (accName.get(String(l.accountId)) ?? "?"),
            )
            .join(" | "),
      );
      skipped += 1;
      continue;
    }

    const cents = hits.reduce((s, l) => s + (l.amount ?? 0), 0);
    console.log(
      "  " +
        (mixed ? "PER-LINE  " : "WHOLE     ") +
        label +
        "  → " +
        (targetCompanyId ? targetLabel : "unassigned"),
    );
    if (inLockedPeriod(bill.invoiceDate)) {
      console.log("        ⚠ inside an active locked period");
    }

    const payments = await BillPayment.countDocuments({ billId: bill._id });
    if (payments > 0) {
      paymentsAffected += payments;
      paymentCents += bill.amount ?? 0;
    }

    moved += 1;
    movedCents += cents;
    if (!APPLY) continue;

    // Re-assert the predicate: a concurrent edit must not be overwritten.
    const currentScopeId = String(bill.scope?.id ?? "");
    if (!reversing && currentScopeId !== "") {
      console.log("        ⚠ scope changed under us — skipped");
      moved -= 1;
      skipped += 1;
      continue;
    }

    if (mixed) {
      // Only the matching lines move; the bill (and its AP credit) stay put.
      bill.lines = lines.map((l) =>
        wanted.has(String(l.accountId))
          ? { ...l, scopeType: "Company", scopeId: targetCompanyId }
          : l,
      ) as typeof bill.lines;
    } else {
      bill.scope = toBillScope({
        type: "Company",
        id: targetCompanyId ? String(targetCompanyId) : null,
      }) as typeof bill.scope;
    }
    await bill.save();

    const existingJe = bill.journalEntryId
      ? await JournalEntry.findOne({
          _id: bill.journalEntryId,
          organizationId: orgObjectId,
        })
      : null;
    const result = await repostBillJournalEntry({
      orgId: ORG_ID,
      ctx,
      existingJe,
      bill: {
        _id: bill._id,
        invoiceDate: bill.invoiceDate,
        memo: bill.memo,
        vendorId: bill.vendorId,
        scope: normalizeScope({
          scopeType: bill.scope?.type,
          scopeId: bill.scope?.id,
        }),
        // Per-line scope and the attachment are both carried through.
        // repair-mortgage-splits.ts drops them, which silently unlinked the
        // attachment on every entry it reposted.
        lines: (bill.lines ?? []).map((l) => ({
          accountId: l.accountId,
          description: l.description,
          amount: l.amount,
          scopeType: l.scopeType ?? null,
          scopeId: l.scopeId ?? null,
        })),
        attachmentFileId: bill.attachmentFileId ?? null,
      },
    });
    // Without this a freshly-created JE would orphan the one on the bill.
    if (String(result.journalEntryId) !== String(bill.journalEntryId)) {
      bill.journalEntryId = result.journalEntryId;
      await bill.save();
    }
  }

  console.log("\n" + "-".repeat(64));
  console.log((APPLY ? "Moved: " : "Would move: ") + moved + " bill(s)");
  if (skipped > 0)
    console.log("Skipped: " + skipped + " bill(s) — reasons above");
  console.log("Expense re-scoped: " + money(movedCents));
  if (paymentsAffected > 0) {
    console.log(
      "\nNOTE: " +
        paymentsAffected +
        " applied payment(s) across " +
        money(paymentCents) +
        " of bills keep the\n" +
        "scope they were posted with (lib/pm/postBillPaymentToLedger.ts stamps it\n" +
        "at payment time). The P&L is unaffected — the matrix reads only Income\n" +
        "and Operating Expense accounts, and the expense debit HAS moved — but\n" +
        "A/P and Cash by entity will not net to zero until those are reposted.",
    );
  }
  if (!APPLY) {
    console.log("\nDry run — nothing was written. Re-run with --apply.");
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
