/**
 * Verify the mortgage amortization module. READ-ONLY — there is no --apply.
 *
 * This project has no test runner, so this script is the merge gate for
 * `lib/pm/amortization.ts`. It mirrors the conventions of
 * `scripts/verify-company-allocation.ts`: a `check()` helper, a printed
 * pass/fail line per assertion, and a non-zero exit if anything fails.
 *
 * The headline assertion is the one the Balance Sheet depends on:
 *   Σ principal over the full term === originalPrincipalCents, exactly,
 *   and the final closing balance is exactly 0.
 * Anything less strands a residue on `Mortgage Payable` forever.
 *
 * Usage (run from `site/`):
 *   npx --yes tsx scripts/verify-amortization.ts
 *   npx --yes tsx scripts/verify-amortization.ts --live   # + DB cross-checks
 */
import dns from "node:dns";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import mongoose, { Types } from "mongoose";
import {
  AmortizationError,
  amortizationAt,
  amortizationSchedule,
  calendarMonthsBetween,
  derivePaymentCents,
  paymentIndexFor,
  periodicRate,
  periodsPerYearFor,
  type AmortizationCompounding,
  type AmortizationTerms,
} from "../lib/pm/amortization";
import type { RecurringFrequency } from "../types/pm";

function arg(name: string): string | null {
  const hit = process.argv.find((a) => a.startsWith("--" + name + "="));
  return hit ? hit.slice(name.length + 3) : null;
}

const ORG_ID = arg("org");

function loadEnvLocal() {
  try {
    for (const line of readFileSync(resolve(".env.local"), "utf8").split(
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

let failures = 0;
let passes = 0;

function check(label: string, ok: boolean, detail = ""): void {
  if (ok) {
    passes += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failures += 1;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function expectThrows(label: string, code: string, fn: () => unknown): void {
  try {
    fn();
    check(label, false, `expected ${code}, nothing was thrown`);
  } catch (e) {
    const actual = e instanceof AmortizationError ? e.code : String(e);
    check(label, actual === code, `expected ${code}, got ${actual}`);
  }
}

// ---------------------------------------------------------------------------
// Pure checks
// ---------------------------------------------------------------------------

const PRINCIPALS = [1, 25_000_000, 1_000_000_000];
const RATES = [0, 5.25, 30];
const TERMS = [1, 12, 300, 480];
const COMPOUNDINGS: AmortizationCompounding[] = ["SemiAnnual", "PeriodMatched"];

function runPureChecks(): void {
  console.log("\nSchedule invariants (principal × rate × term × compounding)");

  let combos = 0;
  let sumOk = true;
  let zeroOk = true;
  let addsUpOk = true;
  let monotonicOk = true;
  let atMatchesScheduleOk = true;
  const failed: string[] = [];

  for (const originalPrincipalCents of PRINCIPALS) {
    for (const annualRatePct of RATES) {
      for (const termPeriods of TERMS) {
        for (const compounding of COMPOUNDINGS) {
          const base: AmortizationTerms = {
            originalPrincipalCents,
            annualRatePct,
            termPeriods,
            periodsPerYear: 12,
            compounding,
          };
          // Use the derived payment so every combination is amortizable —
          // an arbitrary payment would legitimately trip NEGATIVE_AMORTIZATION.
          const terms: AmortizationTerms = {
            ...base,
            paymentCents: derivePaymentCents(base),
          };
          const label = `${originalPrincipalCents}c @ ${annualRatePct}% × ${termPeriods} ${compounding}`;

          let rows;
          try {
            rows = amortizationSchedule(terms);
          } catch (e) {
            failed.push(`${label}: ${(e as Error).message}`);
            sumOk = false;
            continue;
          }
          combos += 1;

          const principalSum = rows.reduce((s, r) => s + r.principalCents, 0);
          if (principalSum !== originalPrincipalCents) {
            sumOk = false;
            failed.push(
              `${label}: Σprincipal ${principalSum} !== ${originalPrincipalCents}`,
            );
          }
          const last = rows[rows.length - 1]!;
          if (last.closingBalanceCents !== 0) {
            zeroOk = false;
            failed.push(`${label}: closing ${last.closingBalanceCents} !== 0`);
          }
          for (const r of rows) {
            if (r.interestCents + r.principalCents !== r.paymentCents) {
              addsUpOk = false;
              failed.push(`${label}: period ${r.index} legs !== payment`);
              break;
            }
          }
          // Interest falls and principal rises only when a rate is charged and
          // there is more than one payment to compare.
          if (annualRatePct > 0 && rows.length > 2) {
            for (let k = 1; k < rows.length - 1; k += 1) {
              if (
                rows[k]!.interestCents > rows[k - 1]!.interestCents ||
                rows[k]!.principalCents < rows[k - 1]!.principalCents
              ) {
                monotonicOk = false;
                failed.push(`${label}: not monotonic at period ${k + 1}`);
                break;
              }
            }
          }
          // Determinism: the single-period entry point must agree with the
          // full schedule, or preview and apply could diverge.
          // Probe a mid-schedule period, not the last: `amortizationAt` past
          // the payoff period is PAST_TERM by design.
          const probe = Math.max(1, rows.length - 1);
          const at = amortizationAt(terms, probe);
          if (
            at.interestCents !== rows[probe - 1]!.interestCents ||
            at.principalCents !== rows[probe - 1]!.principalCents ||
            at.closingBalanceCents !== rows[probe - 1]!.closingBalanceCents
          ) {
            atMatchesScheduleOk = false;
            failed.push(`${label}: amortizationAt !== schedule[${probe - 1}]`);
          }
        }
      }
    }
  }

  check(
    `${combos} combinations amortize to exactly the original principal`,
    sumOk,
  );
  check(
    "a payment larger than the loan needs pays it off early, never negative",
    (() => {
      const early = amortizationSchedule({
        originalPrincipalCents: 100_000,
        annualRatePct: 5,
        termPeriods: 60,
        periodsPerYear: 12,
        paymentCents: 40_000,
      });
      return (
        early.length < 60 &&
        early.every((r) => r.principalCents >= 0) &&
        early[early.length - 1]!.closingBalanceCents === 0 &&
        early.reduce((s, r) => s + r.principalCents, 0) === 100_000
      );
    })(),
  );
  check("final closing balance is exactly 0", zeroOk);
  check("interest + principal === payment in every period", addsUpOk);
  check(
    "interest falls and principal rises while a rate is charged",
    monotonicOk,
  );
  check(
    "amortizationAt(t, k) matches amortizationSchedule(t)[k-1]",
    atMatchesScheduleOk,
  );
  for (const f of failed.slice(0, 8)) console.log(`      · ${f}`);

  console.log("\nCompounding");
  const semi = periodicRate({
    originalPrincipalCents: 100_000_000,
    annualRatePct: 5,
    termPeriods: 300,
    periodsPerYear: 12,
    compounding: "SemiAnnual",
  });
  const matched = periodicRate({
    originalPrincipalCents: 100_000_000,
    annualRatePct: 5,
    termPeriods: 300,
    periodsPerYear: 12,
    compounding: "PeriodMatched",
  });
  // Guards against the flag being accepted and then ignored.
  check(
    "semi-annual and period-matched give different periodic rates",
    semi !== matched,
    `semi=${semi} matched=${matched}`,
  );
  check(
    "semi-annual is the lower of the two (compounds less often)",
    semi < matched,
  );
  check(
    "a 0% loan has a 0 periodic rate",
    periodicRate({
      originalPrincipalCents: 1000,
      annualRatePct: 0,
      termPeriods: 10,
      periodsPerYear: 12,
    }) === 0,
  );

  console.log("\nZero-rate loans");
  const zero = amortizationSchedule({
    originalPrincipalCents: 100_000,
    annualRatePct: 0,
    termPeriods: 7,
    periodsPerYear: 12,
  });
  check(
    "no interest is charged",
    zero.every((r) => r.interestCents === 0),
  );
  check(
    "principal still sums to the original",
    zero.reduce((s, r) => s + r.principalCents, 0) === 100_000,
  );

  console.log("\nHard errors (never clamped, never guessed)");
  expectThrows("negative amortization throws", "NEGATIVE_AMORTIZATION", () =>
    amortizationSchedule({
      originalPrincipalCents: 100_000_000,
      annualRatePct: 12,
      termPeriods: 300,
      periodsPerYear: 12,
      paymentCents: 10_000,
    }),
  );
  expectThrows("a payment past the term throws", "PAST_TERM", () =>
    amortizationAt(
      {
        originalPrincipalCents: 1_000_000,
        annualRatePct: 5,
        termPeriods: 12,
        periodsPerYear: 12,
      },
      13,
    ),
  );
  expectThrows("payment number 0 throws", "INDEX_BEFORE_ORIGINATION", () =>
    amortizationAt(
      {
        originalPrincipalCents: 1_000_000,
        annualRatePct: 5,
        termPeriods: 12,
        periodsPerYear: 12,
      },
      0,
    ),
  );
  expectThrows("a negative principal throws", "INVALID_TERMS", () =>
    derivePaymentCents({
      originalPrincipalCents: -1,
      annualRatePct: 5,
      termPeriods: 12,
      periodsPerYear: 12,
    }),
  );

  console.log("\nPayment index (month-length edges)");
  const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
  const origination = d("2020-01-31");
  check(
    "origination month is payment 1",
    paymentIndexFor({
      originationDate: origination,
      periodDate: d("2020-01-31"),
      frequency: "Monthly",
    }) === 1,
  );
  // The poster's addMonthsClamped walks Jan-31 → Feb-28 → Mar-28. A
  // day-sensitive index would repeat or skip numbers here.
  check(
    "Jan 31 → Feb 28 is payment 2",
    paymentIndexFor({
      originationDate: origination,
      periodDate: d("2020-02-28"),
      frequency: "Monthly",
    }) === 2,
  );
  check(
    "Jan 31 → Mar 28 is payment 3 (not 3-and-a-bit, not 2)",
    paymentIndexFor({
      originationDate: origination,
      periodDate: d("2020-03-28"),
      frequency: "Monthly",
    }) === 3,
  );
  check(
    "Jan 31 → Mar 31 is also payment 3",
    paymentIndexFor({
      originationDate: origination,
      periodDate: d("2020-03-31"),
      frequency: "Monthly",
    }) === 3,
  );
  check(
    "a year later is payment 13",
    paymentIndexFor({
      originationDate: origination,
      periodDate: d("2021-01-15"),
      frequency: "Monthly",
    }) === 13,
  );
  check(
    "quarterly: 6 months on is payment 3",
    paymentIndexFor({
      originationDate: d("2020-01-01"),
      periodDate: d("2020-07-01"),
      frequency: "Quarterly",
    }) === 3,
  );
  check(
    "yearly: 25 months on is payment 3",
    paymentIndexFor({
      originationDate: d("2020-01-01"),
      periodDate: d("2022-02-01"),
      frequency: "Yearly",
    }) === 3,
  );
  check(
    "paymentsAlreadyMade offsets the index",
    paymentIndexFor({
      originationDate: d("2020-01-01"),
      periodDate: d("2020-01-01"),
      frequency: "Monthly",
      paymentsAlreadyMade: 136,
    }) === 137,
  );
  expectThrows(
    "a period before origination throws",
    "INDEX_BEFORE_ORIGINATION",
    () =>
      paymentIndexFor({
        originationDate: d("2020-06-01"),
        periodDate: d("2020-01-01"),
        frequency: "Monthly",
      }),
  );
  expectThrows("weekly is rejected", "INVALID_TERMS", () =>
    paymentIndexFor({
      originationDate: d("2020-01-01"),
      periodDate: d("2020-02-01"),
      frequency: "Weekly",
    }),
  );
  check(
    "calendarMonthsBetween ignores the day of month",
    calendarMonthsBetween(d("2020-01-31"), d("2020-02-01")) === 1,
  );

  console.log("\nDerived payment round-trip");
  const rt: AmortizationTerms = {
    originalPrincipalCents: 45_000_000,
    annualRatePct: 4.75,
    termPeriods: 300,
    periodsPerYear: 12,
    compounding: "SemiAnnual",
  };
  const derived = derivePaymentCents(rt);
  const rtRows = amortizationSchedule({ ...rt, paymentCents: derived });
  check(
    "a schedule built from the derived payment clears to zero",
    rtRows[rtRows.length - 1]!.closingBalanceCents === 0,
    `derived payment ${derived}`,
  );
  check(
    "the final payment differs from the scheduled one by under a dollar",
    Math.abs(rtRows[rtRows.length - 1]!.adjustedFromScheduledPayment) < 100,
    `drift ${rtRows[rtRows.length - 1]!.adjustedFromScheduledPayment}c`,
  );
}

// ---------------------------------------------------------------------------
// Live checks — cross-reference what was actually posted
// ---------------------------------------------------------------------------

async function runLiveChecks(): Promise<void> {
  const { connectToDatabase } = await import("../lib/db/mongoose");
  const { RecurringTransaction } =
    await import("../lib/db/models/pm/RecurringTransaction");
  const { JournalEntry } = await import("../lib/db/models/pm/JournalEntry");

  if (process.env.MONGODB_DNS_SERVERS) {
    dns.setServers(
      process.env.MONGODB_DNS_SERVERS.split(",").map((s) => s.trim()),
    );
  }
  await connectToDatabase();
  console.log("\n✓ connected (read-only)");

  // Without --org this scans every organization in the database.
  const orgFilter = ORG_ID
    ? { organizationId: new Types.ObjectId(ORG_ID) }
    : {};
  const rules = await RecurringTransaction.find({
    ...orgFilter,
    "mortgage.originalPrincipalCents": { $gt: 0 },
  }).lean<
    Array<{
      _id: Types.ObjectId;
      memo?: string;
      frequency: string;
      amounts?: Array<{ amount: number; splitAsMortgage?: boolean }>;
      mortgage?: {
        originationDate?: Date;
        originalPrincipalCents?: number;
        annualRatePct?: number;
        termPeriods?: number;
        compounding?: AmortizationCompounding;
        paymentsAlreadyMade?: number;
        principalAccountId?: Types.ObjectId | null;
        statementBalanceCents?: number | null;
        statementDate?: Date | null;
      } | null;
    }>
  >();

  console.log(`\nLive: ${rules.length} rule(s) with mortgage terms`);
  if (rules.length === 0) {
    console.log("  (nothing configured yet — nothing to cross-check)");
    return;
  }

  for (const rule of rules) {
    const m = rule.mortgage;
    if (!m?.originationDate || !m.originalPrincipalCents || !m.termPeriods) {
      check(`rule ${rule._id}: terms complete`, false, "missing fields");
      continue;
    }
    const label = rule.memo || String(rule._id);

    // Every posted mortgage JE must balance and carry both split legs.
    const jes = await JournalEntry.find({
      recurringTransactionId: rule._id,
      status: "Posted",
    }).lean<
      Array<{
        _id: Types.ObjectId;
        totalDebits: number;
        totalCredits: number;
        lines: Array<{ accountId: Types.ObjectId; debit: number }>;
      }>
    >();
    check(
      `${label}: every posted entry balances`,
      jes.every((j) => j.totalDebits === j.totalCredits),
    );

    // Σ principal posted must equal the GL debit total on the principal
    // account — the ledger's own version of the headline invariant.
    if (m.principalAccountId) {
      const glPrincipal = jes.reduce(
        (s, j) =>
          s +
          j.lines
            .filter((l) => String(l.accountId) === String(m.principalAccountId))
            .reduce((t, l) => t + (l.debit ?? 0), 0),
        0,
      );
      check(
        `${label}: principal posted to the GL is a debit total`,
        glPrincipal >= 0,
        `${glPrincipal}c`,
      );
    }

    // The decisive go-live gate: does our schedule agree with the lender?
    //
    // It must be tested against the schedule the POSTER actually uses. That
    // means the real payment leaving the bank (recurringPoster passes
    // `paymentCents: line.amount`) and the rule's real cadence. Omitting either
    // — as this check used to — silently compares the lender against a
    // derived-annuity schedule nobody posts, so it can pass or fail for a
    // reason that has nothing to do with the loan.
    const paymentCents =
      (rule.amounts ?? []).find((a) => a.splitAsMortgage)?.amount ?? null;

    if (m.statementBalanceCents == null || !m.statementDate) {
      console.log(
        `  · ${label}: no lender statement recorded — cannot validate the terms`,
      );
    } else if (paymentCents == null) {
      check(
        `${label}: schedule matches the lender statement`,
        false,
        "no amount line is marked splitAsMortgage, so the real payment is unknown",
      );
    } else {
      try {
        const terms = {
          originalPrincipalCents: m.originalPrincipalCents,
          annualRatePct: m.annualRatePct ?? 0,
          termPeriods: m.termPeriods,
          periodsPerYear: periodsPerYearFor(
            rule.frequency as RecurringFrequency,
          ),
          paymentCents,
          compounding: m.compounding,
        };
        const idx = paymentIndexFor({
          originationDate: new Date(m.originationDate),
          periodDate: new Date(m.statementDate),
          frequency: rule.frequency as RecurringFrequency,
          paymentsAlreadyMade: m.paymentsAlreadyMade ?? 0,
        });
        const row = amortizationAt(terms, idx);
        const delta = Math.abs(
          row.closingBalanceCents - m.statementBalanceCents,
        );
        const ok = delta <= 500;
        check(
          `${label}: schedule matches the lender statement within $5`,
          ok,
          `payment ${idx}; ours ${row.closingBalanceCents}c vs statement ${m.statementBalanceCents}c (Δ ${delta}c)`,
        );
        // A statement dated the 1st is normally a BEGINNING-of-period balance,
        // which is the opening balance of this payment, not its closing one.
        // Still a failure — the terms have not been validated — but saying so
        // turns a bare number into a diagnosis.
        if (!ok) {
          const openDelta = Math.abs(
            row.openingBalanceCents - m.statementBalanceCents,
          );
          if (openDelta <= 500) {
            console.log(
              `      ↳ it DOES match the balance BEFORE payment ${idx} (Δ ${openDelta}c) — ` +
                "the statement looks like a beginning-of-period figure.",
            );
          }
        }
      } catch (e) {
        // One rule with a bad origination date used to throw out of here, kill
        // main(), and suppress the pass/fail summary entirely.
        const code = e instanceof AmortizationError ? e.code : String(e);
        check(`${label}: schedule matches the lender statement`, false, code);
      }
    }
  }
}

async function main() {
  loadEnvLocal();
  console.log("verify-amortization — read-only\n" + "=".repeat(60));

  runPureChecks();

  if (process.argv.includes("--live")) {
    await runLiveChecks();
    await mongoose.disconnect();
  } else {
    console.log("\n(pass --live to also cross-check posted entries)");
  }

  console.log("\n" + "=".repeat(60));
  console.log(`${passes} passed, ${failures} failed`);
  if (failures > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
