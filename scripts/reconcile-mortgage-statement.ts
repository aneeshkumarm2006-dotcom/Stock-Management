/**
 * Reconcile a stored mortgage against a lender's statement balance, and — when
 * they disagree — SOLVE for which single stored input would explain the gap.
 *
 * READ-ONLY. There is deliberately no --apply. Correcting loan terms changes
 * the interest/principal split of every payment already posted, so this script
 * produces a question for the client, never a write.
 *
 * WHY A SOLVER AND NOT A DELTA. "Our figure is C$42,546.67 lower than yours" is
 * not actionable. "Your figure is what our schedule gives at a rate of 2.7245%
 * rather than the 2.50% we hold" is a question the client's bank can answer in
 * one line. The balance is a function of five inputs; this varies each one in
 * turn, holding the rest, and reports which one reconciles.
 *
 * THE CONVENTION IS PROVED, NOT ASSERTED. "Opening balance for 1 January" is
 * the balance BEFORE that day's payment — `openingBalanceCents` of the period
 * whose index that date maps to. An off-by-one here is the easiest way to
 * manufacture a phantom discrepancy, so section C prints the index derivation
 * and asserts openingBalanceCents(k) === closingBalanceCents(k-1).
 *
 * IT USES THE REAL PAYMENT. lib/pm/recurringPoster.ts splits on the payment
 * that actually leaves the bank (the rule's `splitAsMortgage` amount line), not
 * on a derived annuity payment. A solver built on the annuity payment would be
 * answering about a loan nobody is posting.
 *
 *   npx --yes tsx scripts/reconcile-mortgage-statement.ts --org=<id> \
 *       --as-of=2026-01-01 --rule=GREENE --lender=2709042.28 --solve
 */
import dns from "node:dns";
import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import mongoose, { Types } from "mongoose";
import { connectToDatabase } from "../lib/db/mongoose";
import { RecurringTransaction } from "../lib/db/models/pm/RecurringTransaction";
import { ChartOfAccount } from "../lib/db/models/pm/ChartOfAccount";
import { JournalEntry } from "../lib/db/models/pm/JournalEntry";
import {
  AmortizationError,
  amortizationAt,
  calendarMonthsBetween,
  derivePaymentCents,
  paymentIndexFor,
  periodsPerYearFor,
  type AmortizationCompounding,
  type AmortizationTerms,
} from "../lib/pm/amortization";
import type { RecurringFrequency } from "../types/pm";

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
const AS_OF = arg("as-of") ?? "2026-01-01";
const RULE_ARG = arg("rule");
const LENDER_ARG = arg("lender");
const BASIS = (arg("basis") ?? "before") as "before" | "after";
const SOLVE = process.argv.includes("--solve");
const WINDOW = Number(arg("window") ?? 12);

const money = (c: number) => "C$" + (c / 100).toFixed(2);

/**
 * Balance at `index` under `terms`, on the chosen basis.
 *
 * AmortizationError maps to +Infinity rather than throwing: NEGATIVE_AMORTIZATION
 * and PAST_TERM are both the upper tail of a monotone function, so treating them
 * as "too big" keeps bisection well-defined instead of aborting it.
 */
function balanceAt(
  terms: AmortizationTerms,
  index: number,
  basis: "before" | "after",
): number {
  try {
    const row = amortizationAt(terms, index);
    return basis === "before"
      ? row.openingBalanceCents
      : row.closingBalanceCents;
  } catch (e) {
    if (e instanceof AmortizationError) return Number.POSITIVE_INFINITY;
    throw e;
  }
}

/**
 * Smallest x in [lo, hi] with f(x) >= target, by bisection.
 *
 * Licensed by monotonicity: the recursion is B_k = B_{k-1} + round(B_{k-1}·i) −
 * payment, so ∂B_k/∂B_{k-1} = (1+i) > 0 and by induction the balance is
 * non-decreasing in the original principal and in the rate. Integer-cent
 * rounding makes it a monotone STEP function, so an exact hit may not exist —
 * the caller checks the residual rather than trusting the root.
 */
function bisect(
  lo: number,
  hi: number,
  target: number,
  f: (x: number) => number,
  iterations: number,
): number {
  let a = lo;
  let b = hi;
  for (let i = 0; i < iterations; i += 1) {
    const mid = (a + b) / 2;
    if (f(mid) < target) a = mid;
    else b = mid;
  }
  return b;
}

interface RuleDoc {
  _id: Types.ObjectId;
  memo?: string;
  frequency: string;
  amounts?: Array<{
    amount: number;
    accountId: Types.ObjectId;
    scopeType?: string;
    scopeId?: Types.ObjectId | null;
    splitAsMortgage?: boolean;
  }>;
  mortgage?: {
    originationDate?: Date;
    originalPrincipalCents?: number;
    annualRatePct?: number;
    termPeriods?: number;
    compounding?: AmortizationCompounding;
    paymentsAlreadyMade?: number;
    principalAccountId?: Types.ObjectId | null;
    interestAccountId?: Types.ObjectId | null;
    statementBalanceCents?: number | null;
    statementDate?: Date | null;
  } | null;
}

async function main() {
  loadEnvLocal();
  const servers = process.env.MONGODB_DNS_SERVERS;
  if (servers) dns.setServers(servers.split(",").map((s) => s.trim()));
  await connectToDatabase();
  const orgObjectId = new Types.ObjectId(ORG_ID);

  console.log("reconcile-mortgage-statement — READ-ONLY");
  console.log("ORG:   " + ORG_ID);
  console.log("AS-OF: " + AS_OF + "  (basis: " + BASIS + " the payment)\n");

  const accounts = await ChartOfAccount.find({ organizationId: orgObjectId })
    .select({ _id: 1, name: 1 })
    .lean<Array<{ _id: Types.ObjectId; name: string }>>();
  const accName = new Map(accounts.map((a) => [String(a._id), a.name]));

  let rules = await RecurringTransaction.find({
    organizationId: orgObjectId,
    "mortgage.originalPrincipalCents": { $gt: 0 },
  }).lean<RuleDoc[]>();
  if (RULE_ARG) {
    const needle = RULE_ARG.toUpperCase();
    rules = rules.filter(
      (r) =>
        String(r._id) === RULE_ARG ||
        (r.memo ?? "").toUpperCase().includes(needle),
    );
  }
  if (rules.length === 0) {
    console.log("No mortgage rules matched.");
    return;
  }

  const asOfDate = new Date(AS_OF + "T00:00:00.000Z");

  for (const rule of rules) {
    const m = rule.mortgage!;
    const label = rule.memo || String(rule._id);
    console.log("=".repeat(70));
    console.log(label);
    console.log("=".repeat(70));

    const mortgageLine = (rule.amounts ?? []).find((a) => a.splitAsMortgage);
    const paymentCents = mortgageLine?.amount ?? null;

    // ---- A. stored terms -------------------------------------------------
    console.log("\n--- A. Stored terms ---");
    console.log(
      "  origination        " +
        (m.originationDate
          ? new Date(m.originationDate).toISOString().slice(0, 10)
          : "(unset)"),
    );
    console.log(
      "  original principal " +
        (m.originalPrincipalCents != null
          ? money(m.originalPrincipalCents)
          : "(unset)"),
    );
    console.log("  annual rate        " + (m.annualRatePct ?? "(unset)") + "%");
    console.log("  term periods       " + (m.termPeriods ?? "(unset)"));
    console.log(
      "  compounding        " + (m.compounding ?? "SemiAnnual (default)"),
    );
    console.log("  payments already   " + (m.paymentsAlreadyMade ?? 0));
    console.log("  frequency          " + rule.frequency);
    console.log(
      "  payment (real)     " +
        (paymentCents != null
          ? money(paymentCents)
          : "(no splitAsMortgage line)"),
    );
    console.log(
      "  principal account  " +
        (accName.get(String(m.principalAccountId)) ?? "(unset)"),
    );
    console.log(
      "  interest account   " +
        (accName.get(String(m.interestAccountId)) ?? "(unset)"),
    );
    console.log(
      "  stored statement   " +
        (m.statementBalanceCents != null
          ? money(m.statementBalanceCents) +
            " @ " +
            (m.statementDate
              ? new Date(m.statementDate).toISOString().slice(0, 10)
              : "?")
          : "(none)"),
    );

    if (
      !m.originationDate ||
      !m.originalPrincipalCents ||
      !m.termPeriods ||
      paymentCents == null
    ) {
      console.log("\n  Terms incomplete — cannot reconcile.\n");
      continue;
    }

    const periodsPerYear = periodsPerYearFor(
      rule.frequency as RecurringFrequency,
    );
    const terms: AmortizationTerms = {
      originalPrincipalCents: m.originalPrincipalCents,
      annualRatePct: m.annualRatePct ?? 0,
      termPeriods: m.termPeriods,
      periodsPerYear,
      paymentCents,
      compounding: m.compounding,
    };
    const derived = derivePaymentCents(terms);
    console.log(
      "  derived annuity    " +
        money(derived) +
        "  (drift vs real " +
        money(derived - paymentCents) +
        ")",
    );

    // ---- B. what has actually been posted --------------------------------
    const jes = await JournalEntry.find({
      organizationId: orgObjectId,
      recurringTransactionId: rule._id,
      status: "Posted",
    })
      .sort({ date: 1 })
      .lean<
        Array<{
          date: Date;
          lines: Array<{
            accountId: Types.ObjectId;
            debit: number;
            description?: string;
          }>;
        }>
      >();
    console.log("\n--- B. Posted evidence (" + jes.length + " entries) ---");
    for (const je of jes.slice(-4)) {
      const interest = je.lines
        .filter((l) => String(l.accountId) === String(m.interestAccountId))
        .reduce((s, l) => s + (l.debit ?? 0), 0);
      const principal = je.lines
        .filter((l) => String(l.accountId) === String(m.principalAccountId))
        .reduce((s, l) => s + (l.debit ?? 0), 0);
      const desc = je.lines.find((l) => l.description)?.description ?? "";
      console.log(
        "  " +
          new Date(je.date).toISOString().slice(0, 10) +
          "  interest " +
          money(interest).padStart(12) +
          "  principal " +
          money(principal).padStart(12) +
          "   " +
          desc.slice(0, 40),
      );
    }
    if (jes.length > 4) console.log("  (showing the last 4)");

    // ---- C. our balance at the as-of date, convention proved -------------
    console.log("\n--- C. Our balance at " + AS_OF + " ---");
    const months = calendarMonthsBetween(new Date(m.originationDate), asOfDate);
    const idx = paymentIndexFor({
      originationDate: new Date(m.originationDate),
      periodDate: asOfDate,
      frequency: rule.frequency as RecurringFrequency,
      paymentsAlreadyMade: m.paymentsAlreadyMade ?? 0,
    });
    console.log(
      "  calendarMonthsBetween(origination, as-of) = " +
        months +
        "  → payment index " +
        idx +
        " of " +
        m.termPeriods,
    );
    const row = amortizationAt(terms, idx);
    console.log(
      "  BEFORE payment " +
        idx +
        " (opening)  " +
        money(row.openingBalanceCents),
    );
    console.log(
      "    that payment: interest " +
        money(row.interestCents) +
        " + principal " +
        money(row.principalCents),
    );
    console.log(
      "  AFTER  payment " +
        idx +
        " (closing)  " +
        money(row.closingBalanceCents),
    );
    if (idx > 1) {
      const prev = amortizationAt(terms, idx - 1);
      const proved = prev.closingBalanceCents === row.openingBalanceCents;
      console.log(
        "  " +
          (proved ? "✓" : "✗") +
          " opening(" +
          idx +
          ") === closing(" +
          (idx - 1) +
          ")  — the off-by-one proof",
      );
    }

    const ours =
      BASIS === "before" ? row.openingBalanceCents : row.closingBalanceCents;

    // ---- D. versus the lender -------------------------------------------
    const lenderCents =
      LENDER_ARG != null
        ? Math.round(Number(LENDER_ARG) * 100)
        : (m.statementBalanceCents ?? null);
    if (lenderCents == null) {
      console.log(
        "\n  No --lender figure and none stored — nothing to compare.\n",
      );
      continue;
    }
    const delta = ours - lenderCents;
    console.log("\n--- D. Versus the lender ---");
    console.log("  lender  " + money(lenderCents));
    console.log("  ours    " + money(ours));
    console.log(
      "  delta   " +
        money(delta) +
        "  (" +
        (delta === 0
          ? "exact match"
          : delta < 0
            ? "ours is LOWER — we have amortized too much"
            : "ours is HIGHER — we have amortized too little") +
        ")",
    );
    if (delta !== 0) {
      console.log(
        "  in payment-steps: " +
          (Math.abs(delta) / row.principalCents).toFixed(2) +
          " × this period’s principal (" +
          money(row.principalCents) +
          ")",
      );
    }
    if (Math.abs(delta) <= 500) {
      console.log(
        "  → within $5. The stored terms are validated by this statement.",
      );
      continue;
    }
    if (!SOLVE) {
      console.log("  (pass --solve to search for the input that explains it)");
      continue;
    }

    // ---- E. solve --------------------------------------------------------
    console.log("\n--- E. Which single input would reconcile? ---");

    // 1. payment index — discrete, so sweep rather than bisect. Two levers
    //    produce it and they are interchangeable: originationDate and
    //    paymentsAlreadyMade.
    console.log("\n  (1) payment index");
    let indexHit: number | null = null;
    for (let k = Math.max(1, idx - WINDOW); k <= idx + WINDOW; k += 1) {
      const b = balanceAt(terms, k, BASIS);
      if (!Number.isFinite(b)) continue;
      const d = b - lenderCents;
      if (d === 0) indexHit = k;
      if (Math.abs(d) < row.principalCents * 1.5 || k === idx) {
        const originationShift = k - idx;
        const wouldBe = new Date(m.originationDate);
        wouldBe.setUTCMonth(
          wouldBe.getUTCMonth() - originationShift * (12 / periodsPerYear),
        );
        console.log(
          "      index " +
            String(k).padStart(3) +
            "  balance " +
            money(b).padStart(14) +
            "  residual " +
            money(d).padStart(13) +
            (k === idx ? "   <- stored" : "") +
            (d === 0 ? "   <- EXACT" : ""),
        );
      }
    }
    console.log(
      indexHit != null
        ? "      → index " + indexHit + " reconciles exactly."
        : "      → NO integer payment index reconciles. An off-by-one is not the answer.",
    );

    // 2. annual rate — bisection. Balance is non-decreasing in the rate.
    console.log("\n  (2) annual rate");
    let hiRate = Math.max(terms.annualRatePct, 0.01);
    for (
      let i = 0;
      i < 20 &&
      balanceAt({ ...terms, annualRatePct: hiRate }, idx, BASIS) < lenderCents;
      i += 1
    ) {
      hiRate = Math.min(hiRate * 2, 100);
      if (hiRate >= 100) break;
    }
    const solvedRate = bisect(
      0,
      hiRate,
      lenderCents,
      (r) => balanceAt({ ...terms, annualRatePct: r }, idx, BASIS),
      60,
    );
    const rateBal = balanceAt(
      { ...terms, annualRatePct: solvedRate },
      idx,
      BASIS,
    );
    console.log(
      "      solved rate " +
        solvedRate.toFixed(6) +
        "%  → " +
        money(rateBal) +
        "  residual " +
        money(rateBal - lenderCents),
    );
    for (const step of [0.005, 0.01, 0.025, 0.05]) {
      const rounded = Math.round(solvedRate / step) * step;
      const b = balanceAt({ ...terms, annualRatePct: rounded }, idx, BASIS);
      const dp = derivePaymentCents({ ...terms, annualRatePct: rounded });
      console.log(
        "        at " +
          rounded.toFixed(4) +
          "%  → " +
          money(b).padStart(14) +
          "  residual " +
          money(b - lenderCents).padStart(12) +
          "   annuity payment would be " +
          money(dp),
      );
    }

    // 3. original principal — bisection, integer cents.
    console.log("\n  (3) original principal");
    const gap = lenderCents - ours;
    const loP = Math.max(
      1,
      terms.originalPrincipalCents + Math.min(0, gap) * 2,
    );
    const hiP = terms.originalPrincipalCents + Math.max(0, gap) * 2 + 1000;
    const solvedP = Math.round(
      bisect(
        loP,
        hiP,
        lenderCents,
        (p) =>
          balanceAt(
            { ...terms, originalPrincipalCents: Math.round(p) },
            idx,
            BASIS,
          ),
        60,
      ),
    );
    const pBal = balanceAt(
      { ...terms, originalPrincipalCents: solvedP },
      idx,
      BASIS,
    );
    console.log(
      "      solved principal " +
        money(solvedP) +
        "  (stored " +
        money(terms.originalPrincipalCents) +
        ", difference " +
        money(solvedP - terms.originalPrincipalCents) +
        ")  residual " +
        money(pBal - lenderCents),
    );

    // 4. payment — bisection, DECREASING in the payment, so bisect on the
    //    negated function to keep `bisect`'s "first x with f(x) >= target".
    console.log("\n  (4) payment amount");
    const solvedPay = Math.round(
      bisect(
        1,
        paymentCents * 2,
        -lenderCents,
        (p) =>
          -balanceAt({ ...terms, paymentCents: Math.round(p) }, idx, BASIS),
        60,
      ),
    );
    const payBal = balanceAt({ ...terms, paymentCents: solvedPay }, idx, BASIS);
    console.log(
      "      solved payment " +
        money(solvedPay) +
        "  (real " +
        money(paymentCents) +
        ", difference " +
        money(solvedPay - paymentCents) +
        ")  residual " +
        money(payBal - lenderCents),
    );
    console.log(
      "      NOTE: the payment is evidence, not a variable — it is the amount that left the bank.",
    );

    // 5. compounding — only two values.
    console.log("\n  (5) compounding");
    for (const c of [
      "SemiAnnual",
      "PeriodMatched",
    ] as AmortizationCompounding[]) {
      const b = balanceAt({ ...terms, compounding: c }, idx, BASIS);
      console.log(
        "      " +
          c.padEnd(15) +
          money(b).padStart(14) +
          "  residual " +
          money(b - lenderCents) +
          (c === (m.compounding ?? "SemiAnnual") ? "   <- stored" : ""),
      );
    }

    // 6. term — not a variable at all.
    console.log("\n  (6) term periods");
    console.log(
      "      Not a solver variable: termPeriods enters stepPeriod only through",
    );
    console.log(
      "      `isFinal`, so below the final period it does not touch the balance.",
    );

    console.log("");
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
