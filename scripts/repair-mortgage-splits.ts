/**
 * Re-splits historical mortgage bills that expensed the WHOLE payment.
 *
 * WHAT HAPPENED. The two mortgage recurring rules carry valid loan terms and
 * `splitAsMortgage: true`, so from the moment they started posting (August
 * 2026) each payment lands as two debits: interest -> Mortgage Interest (an
 * operating expense) and principal -> Mortgage Payable (a long-term liability).
 * Every earlier month was keyed by hand as a single line to Mortgage Interest.
 * The result: the P&L overstates interest by the principal portion, and the
 * loan balance never moves.
 *
 * THE FIX. For each unsplit bill, recompute the period's split from the RULE'S
 * OWN terms via `expandRuleAmounts` — the same function the nightly poster
 * calls, so a repaired month is byte-identical to one the cron posted itself —
 * then rewrite `bill.lines` and update the bill's existing JournalEntry IN
 * PLACE through `repostBillJournalEntry`.
 *
 * WHY NOT VOID + REPOST. `repostBillJournalEntry` exists precisely because the
 * reverse-and-repost path left a stray Posted reversal that cancelled the new
 * entry in both P&L aggregators. Updating the same JE leaves exactly one
 * corrected Posted row and nothing for `ledgerVisibleMatch()` to net out.
 *
 * THE INVARIANT. The bill TOTAL never changes — only how it is divided between
 * two debit accounts. That is what makes this safe even with payments applied:
 * a payment is DR Accounts Payable / CR Cash and never touches either account.
 * The script asserts `newTotal === oldTotal` and refuses the bill otherwise.
 *
 * WHICH RULE A BILL BELONGS TO is decided by amount proximity, because the
 * hand-keyed bills carry no `recurringTransactionId` and their memos differ
 * from the rule's by stray punctuation ("IMM. GREEN &" vs "IMM GREENE &"). A
 * match is accepted only when the runner-up is at least 10x further away, so an
 * ambiguous bill is reported and skipped rather than guessed at.
 *
 * SCOPE DRIFT. A bill whose scope disagrees with its rule's — one month of the
 * Cote-des-Neiges mortgage was keyed at Company level, so it dropped out of
 * that property's P&L column — is reported, and corrected unless
 * --no-scope-fix.
 *
 * IDEMPOTENT. A bill that already carries a non-interest leg is not a
 * candidate, so a second run is a no-op.
 *
 * Dry-run by default. Pass --apply to write.
 *   npx --yes tsx scripts/repair-mortgage-splits.ts
 *   npx --yes tsx scripts/repair-mortgage-splits.ts --to=2026-07-31 --apply
 */
import dns from "node:dns";
import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import mongoose, { Types } from "mongoose";
import { connectToDatabase } from "../lib/db/mongoose";
import { Bill } from "../lib/db/models/pm/Bill";
import { BillPayment } from "../lib/db/models/pm/BillPayment";
import { ChartOfAccount } from "../lib/db/models/pm/ChartOfAccount";
import { JournalEntry } from "../lib/db/models/pm/JournalEntry";
import { RecurringTransaction } from "../lib/db/models/pm/RecurringTransaction";
import { expandRuleAmounts } from "../lib/pm/recurringPoster";
import { createCompanyPropertyResolver } from "../lib/pm/companyProperties";
import { repostBillJournalEntry } from "../lib/pm/repostBillJournalEntry";
import { normalizeScope, scopeKey, toBillScope } from "../lib/pm/scope";
import { parseDateWindow } from "../lib/pm/dateWindow";
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
const FIX_SCOPE = !process.argv.includes("--no-scope-fix");
const money = (c: number) => "C$" + (c / 100).toFixed(2);
const day = (d: Date) => d.toISOString().slice(0, 10);

async function main() {
  loadEnvLocal();
  const servers = process.env.MONGODB_DNS_SERVERS;
  if (servers) dns.setServers(servers.split(",").map((s) => s.trim()));
  await connectToDatabase();

  const orgObjectId = new Types.ObjectId(ORG_ID);
  const window = parseDateWindow(arg("from"), arg("to"));

  console.log("MODE:   " + (APPLY ? "APPLY (writing)" : "DRY RUN (no writes)"));
  console.log("ORG:    " + ORG_ID);
  console.log(
    "WINDOW: " +
      (window.start ? day(window.start) : "all time") +
      " -> " +
      (window.endExclusive
        ? day(new Date(window.endExclusive.getTime() - 1))
        : "all time") +
      "\n",
  );

  const rules = await RecurringTransaction.find({
    organizationId: orgObjectId,
    mortgage: { $ne: null },
    "amounts.splitAsMortgage": true,
  });
  if (rules.length === 0) {
    console.log("No mortgage rules with splitAsMortgage — nothing to do.");
    return;
  }

  const interestAccountIds = new Set<string>();
  console.log("Mortgage rules: " + rules.length);
  for (const r of rules) {
    const m = r.mortgage;
    if (!m) continue;
    const payment =
      (r.amounts ?? []).find((a) => a.splitAsMortgage)?.amount ?? 0;
    if (m.interestAccountId)
      interestAccountIds.add(String(m.interestAccountId));
    console.log(
      "  - " +
        r.memo +
        " — " +
        money(payment) +
        " " +
        r.frequency +
        ", " +
        money(m.originalPrincipalCents) +
        " @ " +
        m.annualRatePct +
        "% x" +
        m.termPeriods +
        " from " +
        day(new Date(m.originationDate)),
    );
  }
  console.log();

  const coaRows = await ChartOfAccount.find({ organizationId: orgObjectId })
    .select({ _id: 1, name: 1 })
    .lean<Array<{ _id: Types.ObjectId; name: string }>>();
  const coaNames = new Map(coaRows.map((a) => [String(a._id), a.name]));

  // Candidates: bills whose lines ALL sit on a mortgage interest account, i.e.
  // nothing has been apportioned to principal yet. A bill already carrying a
  // Mortgage Payable leg fails this test, which is what makes the script
  // idempotent.
  const dateFilter: Record<string, Date> = {};
  if (window.start) dateFilter.$gte = window.start;
  if (window.endExclusive) dateFilter.$lt = window.endExclusive;
  const bills = await Bill.find({
    organizationId: orgObjectId,
    status: { $ne: "Voided" },
    "lines.accountId": {
      $in: Array.from(interestAccountIds).map((id) => new Types.ObjectId(id)),
    },
    ...(Object.keys(dateFilter).length > 0 ? { invoiceDate: dateFilter } : {}),
  }).sort({ invoiceDate: 1 });

  const resolveCompany = createCompanyPropertyResolver(ORG_ID);
  const ctx: PmContext = {
    userId: ORG_ID,
    orgId: ORG_ID,
    roles: ["FinancialAdministrator"],
    impersonatedBy: null,
  };

  let repaired = 0;
  let skipped = 0;
  let totalInterest = 0;
  let totalPrincipal = 0;

  for (const bill of bills) {
    const label = day(bill.invoiceDate) + "  " + (bill.memo ?? "").slice(0, 44);
    const lines = bill.lines ?? [];
    if (lines.length === 0) continue;
    const allInterest = lines.every((l) =>
      interestAccountIds.has(String(l.accountId)),
    );
    if (!allInterest) continue; // already split, or not a mortgage bill

    const oldTotal = lines.reduce((s, l) => s + (l.amount ?? 0), 0);

    const ranked = rules
      .map((r) => {
        const payment =
          (r.amounts ?? []).find((a) => a.splitAsMortgage)?.amount ?? 0;
        return { rule: r, distance: Math.abs(payment - oldTotal) };
      })
      .sort((a, b) => a.distance - b.distance);
    const best = ranked[0];
    const runnerUp = ranked[1];
    if (!best) continue;
    if (runnerUp && runnerUp.distance < best.distance * 10) {
      console.log(
        "SKIP  " +
          label +
          "\n      ambiguous: " +
          money(oldTotal) +
          " sits a similar distance from more than one mortgage rule.",
      );
      skipped += 1;
      continue;
    }

    const rule = best.rule;
    const ruleLine = (rule.amounts ?? []).find((a) => a.splitAsMortgage);
    if (!ruleLine) continue;

    // The historical bill's OWN total is the payment that actually left the
    // bank; the rule's stored amount may have been edited since. Only the split
    // is computed — see lib/pm/amortization.ts, "the payment is sacred".
    const expanded = await expandRuleAmounts({
      rule: {
        amounts: [
          {
            accountId: ruleLine.accountId,
            scopeType: ruleLine.scopeType,
            scopeId: ruleLine.scopeId,
            unitId: ruleLine.unitId,
            description: ruleLine.description,
            refNo: ruleLine.refNo,
            amount: oldTotal,
            allocation: null,
            splitAsMortgage: true,
          },
        ],
        mortgage: rule.mortgage,
        frequency: rule.frequency,
      } as Parameters<typeof expandRuleAmounts>[0]["rule"],
      resolve: resolveCompany,
      periodDate: bill.invoiceDate,
    });

    if (expanded.errors.length > 0) {
      console.log("SKIP  " + label + "\n      " + expanded.errors.join("; "));
      skipped += 1;
      continue;
    }

    const newTotal = expanded.lines.reduce((s, l) => s + l.amount, 0);
    if (newTotal !== oldTotal) {
      console.log(
        "SKIP  " +
          label +
          "\n      the split would change the bill total (" +
          money(oldTotal) +
          " -> " +
          money(newTotal) +
          "); refusing.",
      );
      skipped += 1;
      continue;
    }

    const billScope = normalizeScope({
      scopeType: bill.scope?.type,
      scopeId: bill.scope?.id,
    });
    const ruleScope = normalizeScope({
      scopeType: ruleLine.scopeType,
      scopeId: ruleLine.scopeId,
    });
    const scopeDrifted = scopeKey(billScope) !== scopeKey(ruleScope);

    console.log("FIX   " + label);
    console.log("      rule: " + rule.memo);
    for (const l of expanded.lines) {
      console.log(
        "      " +
          (coaNames.get(String(l.accountId)) ?? "?").padEnd(20) +
          money(l.amount).padStart(12),
      );
    }
    if (expanded.mortgage) {
      console.log(
        "      payment #" +
          expanded.mortgage.index +
          ", closing balance " +
          money(expanded.mortgage.closingBalanceCents),
      );
    }
    for (const n of expanded.notes) console.log("      note: " + n);
    if (scopeDrifted) {
      console.log(
        "      scope: " +
          scopeKey(billScope) +
          " -> " +
          scopeKey(ruleScope) +
          (FIX_SCOPE ? " (will correct)" : " (left as-is; --no-scope-fix)"),
      );
    }

    const interest = expanded.lines
      .filter((l) => interestAccountIds.has(String(l.accountId)))
      .reduce((s, l) => s + l.amount, 0);
    totalInterest += interest;
    totalPrincipal += oldTotal - interest;

    if (!APPLY) {
      repaired += 1;
      continue;
    }

    const payments = await BillPayment.countDocuments({ billId: bill._id });
    if (payments > 0) {
      console.log(
        "      " +
          payments +
          " payment(s) applied — unaffected: the bill total is unchanged and payments post DR A/P / CR Cash.",
      );
    }

    bill.lines = expanded.lines.map((l) => ({
      accountId: l.accountId,
      description: l.description,
      amount: l.amount,
    })) as typeof bill.lines;
    if (scopeDrifted && FIX_SCOPE) {
      bill.scope = toBillScope(ruleScope) as typeof bill.scope;
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
        lines: (bill.lines ?? []).map((l) => ({
          accountId: l.accountId,
          description: l.description,
          amount: l.amount,
        })),
      },
    });
    // Without this a freshly-created JE would orphan the one on the bill.
    if (String(result.journalEntryId) !== String(bill.journalEntryId)) {
      bill.journalEntryId = result.journalEntryId;
      await bill.save();
    }
    repaired += 1;
  }

  console.log("\n" + "-".repeat(64));
  console.log(
    (APPLY ? "Repaired: " : "Would repair: ") + repaired + " bill(s)",
  );
  if (skipped > 0) {
    console.log("Skipped:  " + skipped + " bill(s) — reasons above");
  }
  console.log("Interest kept on the P&L:    " + money(totalInterest));
  console.log("Principal moved to the loan: " + money(totalPrincipal));
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
