// Edit recurring check / bill / journal-entry modal.
//
// SCOPE. Each amount row carries its own `scopeType`/`scopeId`, matching the
// per-line scope model the GL uses everywhere else (reports attribute a
// property from `lines[].scopeId`, never the entry header — see
// app/api/pm/financials/matrix/route.ts). A row targets a property OR a named
// company, picked through the shared <ScopePicker>.
//
// A rule whose rows span several scopes posts one Bill per scope at run time
// (a Bill's `scope` is a single {type,id} and cannot represent two) — hence the
// inline hint under the grid.
//
// SPLIT. A row on a named company can be split across that company's
// buildings, for costs like a blanket insurance premium that covers all of
// them. The split does NOT create extra bills: the payable stays whole on the
// company and only the expense lines carry each building's share, so the vendor
// still gets one invoice. Excluded buildings (those booking in another
// currency) are named on screen — the ledger never converts on write.
//
// `unitId` and `refNo` are hydrated and re-submitted untouched but not
// rendered: nothing consumes them yet (postBillToLedger hardcodes
// `unitId: null`, and neither IBillLine nor IJournalLine has a refNo), so an
// input for them would be silently dropped at posting time. Round-tripping
// them means a rule set up via the API keeps them.
"use client";

import * as React from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { CurrencyAmount } from "@/components/pm/CurrencyAmount";
import {
  amortizationAt,
  derivePaymentCents,
  periodsPerYearFor,
} from "@/lib/pm/amortization";
import { ScopePicker, useCompanyAccounts } from "@/components/pm/ScopePicker";
import { parseCurrencyToDollars } from "@/lib/pm/currency";
import { scopeFromInput, scopeKeyOf } from "@/lib/pm/scope";
import { allocateCents } from "@/lib/pm/allocation";
import {
  RECURRING_DURATIONS,
  RECURRING_FREQUENCIES,
  RECURRING_PAYEE_TYPES,
  RECURRING_TRANSACTION_TYPES,
  type RecurringDuration,
  type RecurringFrequency,
  type RecurringPayeeType,
  type RecurringTransactionType,
} from "@/types/pm";

interface VendorOption {
  id: string;
  displayName: string;
}
interface OwnerOption {
  id: string;
  displayName: string;
}
interface AccountOption {
  id: string;
  name: string;
  /** Kept so the pickers can filter: group headers are not postable. */
  type: string;
  isGroup: boolean;
}
interface BankOption {
  id: string;
  name: string;
}
interface PropertyOption {
  id: string;
  name: string;
}

interface AmountRow {
  // Unique key for React; not sent to the API. Rows carry <select>s, so an
  // index key would hand a removed row's DOM state to its successor.
  key: string;
  scopeType: "Property" | "Company";
  scopeId: string;
  accountId: string;
  description: string;
  // Raw text input (dollars). Parsed/validated on submit via
  // parseCurrencyToDollars so "1,234.56" / "$1234.56" survive entry.
  amount: string;
  /** Split this amount across the named company's buildings. */
  split: boolean;
  /**
   * This line is the mortgage payment: the poster splits it into an interest
   * leg and a principal leg using the rule-level loan terms. Only one line per
   * rule may carry it.
   */
  splitAsMortgage: boolean;
  // Round-tripped, not edited here. See the file header.
  unitId: string | null;
  refNo: string | null;
}

/**
 * Loan terms as edited. Everything is a string so a half-typed field doesn't
 * become NaN; converted to numbers at submit, and to cents at the API boundary.
 */
interface MortgageForm {
  originationDate: string;
  originalPrincipal: string;
  annualRatePct: string;
  termPeriods: string;
  compounding: "SemiAnnual" | "PeriodMatched";
  paymentsAlreadyMade: string;
  principalAccountId: string;
  interestAccountId: string;
  statementBalance: string;
  statementDate: string;
}

/** GET /api/pm/company-accounts/[id]/properties */
interface CompanyPropertySet {
  companyAccountId: string;
  companyName: string;
  currency: string;
  members: Array<{ propertyId: string; propertyName: string; weight: number }>;
  excluded: Array<{
    propertyId: string;
    propertyName: string;
    currency: string;
    reason: string;
  }>;
  allocatable: boolean;
}

/**
 * The "split this across the company's buildings" control.
 *
 * Shows the resulting shares before anything is saved, computed with the same
 * largest-remainder helper the poster uses, so the pennies on screen are the
 * pennies that post. Properties excluded for booking in another currency are
 * named rather than silently omitted — the ledger never converts on write, so
 * a CAD premium simply cannot be apportioned onto a USD building.
 */
function SplitRow({
  index,
  row,
  set,
  onToggle,
}: {
  index: number;
  row: AmountRow;
  set?: CompanyPropertySet;
  onToggle: (v: boolean) => void;
}) {
  const dollars = parseCurrencyToDollars(row.amount) ?? 0;
  const shares = React.useMemo(() => {
    if (!set || set.members.length === 0) return [];
    return allocateCents(
      Math.round(dollars * 100),
      set.members.map((m) => ({ key: m.propertyId, weight: m.weight })),
    );
  }, [set, dollars]);

  const nameById = React.useMemo(
    () => new Map((set?.members ?? []).map((m) => [m.propertyId, m.propertyName])),
    [set],
  );

  const excludedForCurrency = (set?.excluded ?? []).filter(
    (e) => e.reason === "CURRENCY_MISMATCH",
  );

  const memberCount = set?.members.length ?? 0;
  const disabled = !set || memberCount === 0 || memberCount === 1;

  let hint: string;
  if (!set) hint = "Loading buildings…";
  else if (memberCount === 0) {
    hint = `No ${set.currency} buildings are assigned to ${set.companyName} yet.`;
  } else if (memberCount === 1) {
    hint = `Only one building is assigned to ${set.companyName} — a split would be the same as choosing that building.`;
  } else {
    hint = `${memberCount} buildings, split evenly · ${set.currency}`;
  }

  return (
    <div className="space-y-1 pl-1 text-xs">
      <label className="flex items-center gap-2 text-fg">
        <input
          type="checkbox"
          checked={row.split && !disabled}
          disabled={disabled}
          aria-label={`Line ${index + 1} split across company properties`}
          onChange={(e) => onToggle(e.target.checked)}
        />
        <span>
          Split this amount across {set?.companyName ?? "this company"}
          &rsquo;s buildings
        </span>
      </label>
      <p className="pl-6 text-fg-muted">{hint}</p>
      {row.split && !disabled && shares.length > 0 ? (
        <p className="pl-6 text-fg-muted">
          {shares
            .map(
              (s) =>
                `${nameById.get(s.key) ?? "?"} ${(s.cents / 100).toFixed(2)}`,
            )
            .join(" · ")}
        </p>
      ) : null}
      {excludedForCurrency.length > 0 ? (
        <p className="pl-6 text-warning">
          {set!.companyName} books in {set!.currency}; excluded from the split:{" "}
          {excludedForCurrency
            .map((e) => `${e.propertyName} (${e.currency})`)
            .join(", ")}
          . Add a separate rule for those.
        </p>
      ) : null}
      {row.split && !disabled ? (
        <p className="pl-6 text-fg-muted">
          One bill to the payee; each building carries its share.
        </p>
      ) : null}
    </div>
  );
}

function newAmountRow(): AmountRow {
  return {
    key: Math.random().toString(36).slice(2, 10),
    scopeType: "Company",
    scopeId: "",
    accountId: "",
    description: "",
    amount: "",
    split: false,
    splitAsMortgage: false,
    unitId: null,
    refNo: null,
  };
}

/** Empty loan terms — dollars/strings, converted at the API boundary. */
function emptyMortgage(): MortgageForm {
  return {
    originationDate: "",
    originalPrincipal: "",
    annualRatePct: "",
    termPeriods: "",
    compounding: "SemiAnnual",
    paymentsAlreadyMade: "",
    principalAccountId: "",
    interestAccountId: "",
    statementBalance: "",
    statementDate: "",
  };
}

interface EditRecurringCheckModalProps {
  open: boolean;
  mode: "create" | "edit";
  recurringId?: string;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}

export function EditRecurringCheckModal({
  open,
  mode,
  recurringId,
  onClose,
  onSaved,
}: EditRecurringCheckModalProps) {
  const { toast } = useToast();
  const [vendors, setVendors] = React.useState<VendorOption[]>([]);
  const [owners, setOwners] = React.useState<OwnerOption[]>([]);
  const [accounts, setAccounts] = React.useState<AccountOption[]>([]);
  const [banks, setBanks] = React.useState<BankOption[]>([]);
  const [properties, setProperties] = React.useState<PropertyOption[]>([]);
  const companies = useCompanyAccounts(open);
  // Split previews, keyed by company id. Fetched lazily the first time a row
  // names a company so the modal's five parallel fetches don't grow with the
  // number of companies in the org.
  const [companySets, setCompanySets] = React.useState<
    Record<string, CompanyPropertySet>
  >({});
  // Bulk-apply helper above the grid. Client-only; never persisted.
  const [applyAll, setApplyAll] = React.useState<{
    scopeType: "Property" | "Company";
    scopeId: string;
  }>({ scopeType: "Company", scopeId: "" });

  const [type, setType] = React.useState<RecurringTransactionType>("Bill");
  const [payeeType, setPayeeType] =
    React.useState<RecurringPayeeType>("Vendor");
  const [payeeId, setPayeeId] = React.useState("");
  const [bankAccountId, setBankAccountId] = React.useState("");
  const [memo, setMemo] = React.useState("");
  const [frequency, setFrequency] =
    React.useState<RecurringFrequency>("Monthly");
  const [nextDate, setNextDate] = React.useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [postNDaysInAdvance, setPostNDaysInAdvance] = React.useState(5);
  const [duration, setDuration] =
    React.useState<RecurringDuration>("Until cancelled");
  const [occurrenceCount, setOccurrenceCount] = React.useState(12);
  const [queueForPrinting, setQueueForPrinting] = React.useState(false);
  const [active, setActive] = React.useState(true);
  const [amounts, setAmounts] = React.useState<AmountRow[]>(() => [
    newAmountRow(),
  ]);
  const [mortgage, setMortgage] = React.useState<MortgageForm>(emptyMortgage);
  const [saving, setSaving] = React.useState(false);

  // Postable accounts only — the chart-of-accounts endpoint returns group
  // headers too, and posting to one is not valid.
  const postable = React.useMemo(
    () => accounts.filter((a) => !a.isGroup),
    [accounts],
  );
  const liabilityAccounts = React.useMemo(
    () => postable.filter((a) => a.type === "Long-term Liability"),
    [postable],
  );
  const expenseAccounts = React.useMemo(
    () => postable.filter((a) => a.type === "Operating Expense"),
    [postable],
  );
  const mortgageLineIndex = amounts.findIndex((a) => a.splitAsMortgage);
  const isMortgageRule = mortgageLineIndex >= 0;

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetch("/api/pm/vendors").then(async (r) => {
      if (r.ok && !cancelled) setVendors((await r.json()) as VendorOption[]);
    });
    fetch("/api/pm/rental-owners").then(async (r) => {
      if (r.ok && !cancelled) setOwners((await r.json()) as OwnerOption[]);
    });
    fetch("/api/pm/chart-of-accounts").then(async (r) => {
      if (r.ok && !cancelled) setAccounts((await r.json()) as AccountOption[]);
    });
    fetch("/api/pm/bank-accounts").then(async (r) => {
      if (r.ok && !cancelled) setBanks((await r.json()) as BankOption[]);
    });
    fetch("/api/pm/properties").then(async (r) => {
      if (!r.ok || cancelled) return;
      const rows = (await r.json()) as { id: string; propertyName: string }[];
      if (cancelled) return;
      setProperties(rows.map((p) => ({ id: p.id, name: p.propertyName })));
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  React.useEffect(() => {
    if (!open || mode !== "edit" || !recurringId) return;
    fetch(`/api/pm/recurring-transactions/${recurringId}`).then(async (r) => {
      if (!r.ok) return;
      const d = (await r.json()) as {
        type: RecurringTransactionType;
        payee: { type: RecurringPayeeType; id: string } | null;
        bankAccountId: string | null;
        memo: string;
        frequency: RecurringFrequency;
        nextDate: string;
        postNDaysInAdvance: number;
        duration: RecurringDuration;
        occurrenceCount: number | null;
        queueForPrinting: boolean;
        active: boolean;
        amounts: Array<{
          scopeType?: "Property" | "Company" | null;
          scopeId?: string | null;
          accountId: string;
          description: string;
          amount: number;
          allocation?: { mode?: string } | null;
          splitAsMortgage?: boolean;
          unitId?: string | null;
          refNo?: string | null;
        }>;
        mortgage?: {
          originationDate: string;
          originalPrincipalCents: number;
          annualRatePct: number;
          termPeriods: number;
          compounding: "SemiAnnual" | "PeriodMatched";
          paymentsAlreadyMade: number;
          principalAccountId: string | null;
          interestAccountId: string | null;
          statementBalanceCents: number | null;
          statementDate: string | null;
        } | null;
      };
      setType(d.type);
      setPayeeType(d.payee?.type ?? "Vendor");
      setPayeeId(d.payee?.id ?? "");
      setBankAccountId(d.bankAccountId ?? "");
      setMemo(d.memo);
      setFrequency(d.frequency);
      setNextDate(new Date(d.nextDate).toISOString().slice(0, 10));
      setPostNDaysInAdvance(d.postNDaysInAdvance);
      setDuration(d.duration);
      setOccurrenceCount(d.occurrenceCount ?? 12);
      setQueueForPrinting(d.queueForPrinting);
      setActive(d.active);
      setApplyAll({ scopeType: "Company", scopeId: "" });
      setMortgage(
        d.mortgage
          ? {
              originationDate: d.mortgage.originationDate,
              originalPrincipal: String(
                d.mortgage.originalPrincipalCents / 100,
              ),
              annualRatePct: String(d.mortgage.annualRatePct),
              termPeriods: String(d.mortgage.termPeriods),
              compounding: d.mortgage.compounding,
              paymentsAlreadyMade: d.mortgage.paymentsAlreadyMade
                ? String(d.mortgage.paymentsAlreadyMade)
                : "",
              principalAccountId: d.mortgage.principalAccountId ?? "",
              interestAccountId: d.mortgage.interestAccountId ?? "",
              statementBalance:
                d.mortgage.statementBalanceCents == null
                  ? ""
                  : String(d.mortgage.statementBalanceCents / 100),
              statementDate: d.mortgage.statementDate ?? "",
            }
          : emptyMortgage(),
      );
      setAmounts(
        d.amounts.map((a) => {
          // Normalise through the same predicate the server uses, so a legacy
          // shape (missing field, Property with a null id) degrades exactly as
          // it does everywhere else. Crucially this PRESERVES a Company row's
          // scopeId: dropping it used to mean opening a rule that named a
          // company and pressing Save silently reverted it to the unnamed
          // bucket.
          const scope = scopeFromInput(a.scopeType, a.scopeId);
          return {
          ...newAmountRow(),
          scopeType: scope.type,
          scopeId: scope.id ? String(scope.id) : "",
          accountId: a.accountId,
          description: a.description,
          // server returns cents; show dollars as editable text
          amount: String(a.amount / 100),
          split: a.allocation?.mode === "CompanyProperties",
          // Round-tripping this matters: dropping it here would mean opening a
          // configured mortgage and pressing Save silently reverts the rule to
          // booking 100% of the payment as expense, with no error shown.
          splitAsMortgage: a.splitAsMortgage === true,
          unitId: a.unitId ?? null,
          // GET returns '' rather than null for an unset refNo; normalise so
          // the submit path can send `undefined` (the validator types refNo as
          // an optional string, not a nullable one).
          refNo: a.refNo || null,
          };
        }),
      );
    });
  }, [open, mode, recurringId]);

  // Lazily load the split preview for every company named on a row.
  React.useEffect(() => {
    if (!open) return;
    const wanted = Array.from(
      new Set(
        amounts
          .filter((a) => a.scopeType === "Company" && a.scopeId)
          .map((a) => a.scopeId),
      ),
    ).filter((id) => !companySets[id]);
    if (wanted.length === 0) return;
    let cancelled = false;
    Promise.all(
      wanted.map(async (id) => {
        const r = await fetch(`/api/pm/company-accounts/${id}/properties`);
        if (!r.ok) return null;
        return (await r.json()) as CompanyPropertySet;
      }),
    ).then((sets) => {
      if (cancelled) return;
      const next: Record<string, CompanyPropertySet> = {};
      for (const s of sets) if (s) next[s.companyAccountId] = s;
      if (Object.keys(next).length > 0) {
        setCompanySets((prev) => ({ ...prev, ...next }));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [open, amounts, companySets]);

  // Same clear-on-close reasoning as the company list: a stale preview from a
  // previous open would show the wrong buildings for a moment.
  React.useEffect(() => {
    if (!open) setCompanySets({});
  }, [open]);

  // Live total of the grid, in dollars. Unparseable rows contribute 0 rather
  // than poisoning the sum with NaN.
  const amountsTotal = React.useMemo(
    () =>
      amounts.reduce((sum, a) => sum + (parseCurrencyToDollars(a.amount) ?? 0), 0),
    [amounts],
  );

  // Distinct scopes across rows that name an account — this is exactly how the
  // poster groups a rule into separate bills, so the hint below the grid can
  // never disagree with what actually posts.
  const scopeGroupCount = React.useMemo(
    () =>
      new Set(
        amounts
          .filter((a) => a.accountId)
          .map((a) => scopeKeyOf({ scopeType: a.scopeType, scopeId: a.scopeId })),
      ).size,
    [amounts],
  );

  function addRow() {
    setAmounts([...amounts, newAmountRow()]);
  }

  /** Bulk-set every row's scope from the picker above the grid. */
  function applyScopeToAllRows(next: {
    scopeType: "Property" | "Company";
    scopeId: string;
  }) {
    setApplyAll(next);
    setAmounts(
      amounts.map((a) => ({
        ...a,
        scopeType: next.scopeType,
        scopeId: next.scopeId,
        // A split only means something on a named company.
        split:
          a.split && next.scopeType === "Company" && Boolean(next.scopeId),
      })),
    );
  }
  function removeRow(idx: number) {
    setAmounts(amounts.filter((_, i) => i !== idx));
  }
  function updateRow<K extends keyof AmountRow>(
    idx: number,
    key: K,
    value: AmountRow[K],
  ) {
    setAmounts(
      amounts.map((a, i) =>
        i === idx ? ({ ...a, [key]: value } as AmountRow) : a,
      ),
    );
  }

  async function deleteRule() {
    if (mode !== "edit" || !recurringId) return;
    if (
      !confirm(
        "Delete this recurring rule? Already-posted occurrences are kept; no new postings will fire.",
      )
    ) {
      return;
    }
    setSaving(true);
    const res = await fetch(`/api/pm/recurring-transactions/${recurringId}`, {
      method: "DELETE",
    });
    setSaving(false);
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      toast({
        title: "Delete failed",
        description: err.error,
        variant: "error",
      });
      return;
    }
    toast({ title: "Recurring rule deleted", variant: "success" });
    onClose();
    await onSaved();
  }

  async function save() {
    if (type !== "Journal entry" && !payeeId) {
      toast({ title: "Payee is required for Check / Bill", variant: "error" });
      return;
    }
    if (!amounts.some((a) => a.accountId)) {
      toast({
        title: "Add at least one line with an account",
        variant: "error",
      });
      return;
    }
    // Parse each currency input; reject non-numeric rather than coercing to NaN.
    // Iterate over `amounts` (not a filtered copy) so the reported line number
    // matches the row the user is looking at.
    const parsedAmounts: Array<{
      scopeType: "Property" | "Company";
      scopeId: string | null;
      accountId: string;
      description: string | undefined;
      amount: number;
      allocation: { mode: "CompanyProperties"; basis: "Equal" } | null;
      splitAsMortgage: boolean;
      unitId: string | null;
      refNo: string | undefined;
    }> = [];
    for (let i = 0; i < amounts.length; i++) {
      const a = amounts[i]!;
      if (!a.accountId) continue;
      const dollars = parseCurrencyToDollars(a.amount);
      if (dollars === null) {
        toast({
          title: `Line ${i + 1}: enter a valid amount`,
          variant: "error",
        });
        return;
      }
      if (a.scopeType === "Property" && !a.scopeId) {
        toast({
          title: `Line ${i + 1}: choose a property or company`,
          variant: "error",
        });
        return;
      }
      parsedAmounts.push({
        scopeType: a.scopeType,
        // Must be null, never "" — the validator's scopeId is a 24-hex regex.
        // A Company scopeId is now PRESERVED: nulling it here is what used to
        // silently discard the company on every save.
        scopeId: a.scopeId || null,
        accountId: a.accountId,
        description: a.description.trim() || undefined,
        amount: dollars, // dollars; server toCents() converts
        allocation:
          a.split && a.scopeType === "Company" && a.scopeId
            ? { mode: "CompanyProperties", basis: "Equal" }
            : null,
        splitAsMortgage: a.splitAsMortgage === true,
        unitId: a.scopeType === "Property" ? a.unitId : null,
        refNo: a.refNo ?? undefined,
      });
    }
    setSaving(true);
    const payload: Record<string, unknown> = {
      type,
      payee:
        type !== "Journal entry" && payeeId
          ? { type: payeeType, id: payeeId }
          : null,
      bankAccountId: bankAccountId || null,
      memo: memo.trim() || undefined,
      frequency,
      nextDate: new Date(nextDate).toISOString(),
      postNDaysInAdvance,
      duration,
      occurrenceCount: duration === "End after N" ? occurrenceCount : null,
      amounts: parsedAmounts,
      // Send `null` when no line is flagged, so unticking the box clears the
      // terms rather than leaving orphaned loan data behind.
      mortgage: parsedAmounts.some((a) => a.splitAsMortgage)
        ? {
            originationDate: new Date(
              mortgage.originationDate,
            ).toISOString(),
            originalPrincipal: Number(mortgage.originalPrincipal),
            annualRatePct: Number(mortgage.annualRatePct),
            termPeriods: Number(mortgage.termPeriods),
            compounding: mortgage.compounding,
            paymentsAlreadyMade: Number(mortgage.paymentsAlreadyMade || 0),
            principalAccountId: mortgage.principalAccountId,
            interestAccountId: mortgage.interestAccountId,
            statementBalance: mortgage.statementBalance
              ? Number(mortgage.statementBalance)
              : null,
            statementDate: mortgage.statementDate
              ? new Date(mortgage.statementDate).toISOString()
              : null,
          }
        : null,
      queueForPrinting,
      active,
    };
    const url =
      mode === "create"
        ? "/api/pm/recurring-transactions"
        : `/api/pm/recurring-transactions/${recurringId}`;
    const method = mode === "create" ? "POST" : "PATCH";
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setSaving(false);
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      toast({ title: "Failed", description: err.error, variant: "error" });
      return;
    }
    toast({
      title:
        mode === "create" ? "Recurring rule created" : "Recurring rule updated",
      variant: "success",
    });
    onClose();
    await onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl">
        <DialogHeader
          title={
            mode === "create" ? "New recurring rule" : "Edit recurring rule"
          }
          onClose={onClose}
        />
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor="rt-type">Type *</Label>
              <select
                id="rt-type"
                className="w-full rounded border border-border bg-surface px-3 py-1.5 text-sm text-fg"
                value={type}
                onChange={(e) =>
                  setType(e.target.value as RecurringTransactionType)
                }
              >
                {RECURRING_TRANSACTION_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="rt-frequency">Frequency *</Label>
              <select
                id="rt-frequency"
                className="w-full rounded border border-border bg-surface px-3 py-1.5 text-sm text-fg"
                value={frequency}
                onChange={(e) =>
                  setFrequency(e.target.value as RecurringFrequency)
                }
              >
                {RECURRING_FREQUENCIES.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="rt-next">Next date *</Label>
              <Input
                id="rt-next"
                type="date"
                value={nextDate}
                onChange={(e) => setNextDate(e.target.value)}
              />
            </div>
          </div>

          {type !== "Journal entry" && (
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="rt-payee-type">Payee type *</Label>
                <select
                  id="rt-payee-type"
                  className="w-full rounded border border-border bg-surface px-3 py-1.5 text-sm text-fg"
                  value={payeeType}
                  onChange={(e) =>
                    setPayeeType(e.target.value as RecurringPayeeType)
                  }
                >
                  {RECURRING_PAYEE_TYPES.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="rt-payee">Payee *</Label>
                <select
                  id="rt-payee"
                  className="w-full rounded border border-border bg-surface px-3 py-1.5 text-sm text-fg"
                  value={payeeId}
                  onChange={(e) => setPayeeId(e.target.value)}
                >
                  <option value="">Choose…</option>
                  {(payeeType === "Vendor" ? vendors : owners).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.displayName}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor="rt-bank">Bank account</Label>
              <select
                id="rt-bank"
                className="w-full rounded border border-border bg-surface px-3 py-1.5 text-sm text-fg"
                value={bankAccountId}
                onChange={(e) => setBankAccountId(e.target.value)}
              >
                <option value="">Default trust account</option>
                {banks.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="rt-lead">Post N days in advance</Label>
              <Input
                id="rt-lead"
                type="number"
                min={0}
                max={60}
                value={postNDaysInAdvance}
                onChange={(e) =>
                  setPostNDaysInAdvance(Number(e.target.value) || 0)
                }
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="rt-duration">Duration</Label>
              <select
                id="rt-duration"
                className="w-full rounded border border-border bg-surface px-3 py-1.5 text-sm text-fg"
                value={duration}
                onChange={(e) =>
                  setDuration(e.target.value as RecurringDuration)
                }
              >
                {RECURRING_DURATIONS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {duration === "End after N" && (
            <div className="space-y-1 md:w-1/3">
              <Label htmlFor="rt-count">Occurrence count *</Label>
              <Input
                id="rt-count"
                type="number"
                min={1}
                value={occurrenceCount}
                onChange={(e) =>
                  setOccurrenceCount(Number(e.target.value) || 1)
                }
              />
            </div>
          )}

          <div className="space-y-1">
            <Label htmlFor="rt-memo">Memo (≤256 chars)</Label>
            <Input
              id="rt-memo"
              maxLength={256}
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
            />
            <span className="text-[10px] uppercase tracking-widest text-fg-muted">
              {memo.length}/256
            </span>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-bold uppercase tracking-widest text-fg-muted">
                Amounts
              </h4>
              <Button size="sm" variant="outline" onClick={addRow}>
                <Plus className="h-3.5 w-3.5" /> Add row
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Label
                htmlFor="rt-apply-all"
                className="text-xs uppercase tracking-widest text-fg-muted"
              >
                Apply to all rows
              </Label>
              <div className="min-w-[220px]">
                <ScopePicker
                  id="rt-apply-all"
                  scopeType={applyAll.scopeType}
                  scopeId={applyAll.scopeId}
                  properties={properties}
                  companies={companies}
                  placeholder="Choose…"
                  className="rounded border border-border bg-surface px-2 py-1 text-sm text-fg"
                  onChange={applyScopeToAllRows}
                />
              </div>
            </div>
            <div className="overflow-x-auto rounded border border-border">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="border-b border-border text-left text-xs uppercase tracking-widest text-fg-muted">
                  <tr>
                    <th className="px-2 py-1">Property or company</th>
                    <th className="px-2">Account</th>
                    <th className="px-2">Description</th>
                    <th className="px-2 text-right">Amount</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {amounts.map((a, i) => (
                    <React.Fragment key={a.key}>
                    <tr className="border-b border-border/40">
                      <td className="w-56 px-2 py-1">
                        {/* One merged select instead of a Co./Prop. toggle
                            plus a disabled property dropdown: it removes a
                            control from a 224px cell rather than adding one,
                            and makes "Property with no property" unreachable. */}
                        <ScopePicker
                          aria-label={`Line ${i + 1} property or company`}
                          className="w-full rounded border border-border bg-surface px-1 py-1 text-xs text-fg"
                          scopeType={a.scopeType}
                          scopeId={a.scopeId}
                          properties={properties}
                          companies={companies}
                          onChange={(next) => {
                            setAmounts(
                              amounts.map((row, idx) =>
                                idx === i
                                  ? {
                                      ...row,
                                      scopeType: next.scopeType,
                                      scopeId: next.scopeId,
                                      // Drop the unit when this stops being a
                                      // property so a stale id can't be sent.
                                      unitId:
                                        next.scopeType === "Property"
                                          ? row.unitId
                                          : null,
                                      // A split only means something on a
                                      // named company.
                                      split:
                                        row.split &&
                                        next.scopeType === "Company" &&
                                        Boolean(next.scopeId),
                                    }
                                  : row,
                              ),
                            );
                          }}
                        />
                      </td>
                      <td className="w-56 px-2 py-1">
                        <select
                          aria-label={`Line ${i + 1} account`}
                          className="w-full rounded border border-border bg-surface px-2 py-1 text-sm text-fg"
                          value={a.accountId}
                          onChange={(e) =>
                            updateRow(i, "accountId", e.target.value)
                          }
                        >
                          <option value="">Choose…</option>
                          {/* Group headers are not postable — they exist to
                              nest the chart, not to receive entries. */}
                          {postable.map((acc) => (
                            <option key={acc.id} value={acc.id}>
                              {acc.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-2 py-1">
                        <Input
                          aria-label={`Line ${i + 1} description`}
                          value={a.description}
                          onChange={(e) =>
                            updateRow(i, "description", e.target.value)
                          }
                        />
                      </td>
                      <td className="w-28 px-2 py-1">
                        <Input
                          type="text"
                          inputMode="decimal"
                          placeholder="0.00"
                          aria-label={`Line ${i + 1} amount`}
                          value={a.amount}
                          onChange={(e) =>
                            updateRow(i, "amount", e.target.value)
                          }
                        />
                      </td>
                      <td className="w-8 px-2 text-right">
                        <button
                          type="button"
                          onClick={() => removeRow(i)}
                          aria-label={`Remove line ${i + 1}`}
                          className="text-fg-muted hover:text-error"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                    {/* Mortgage toggle. Offered on every row, but only one row
                        per rule may carry it — a second loan belongs on its own
                        rule with its own origination date. Hidden entirely on a
                        split row: allocating a mortgage across properties would
                        need the PRINCIPAL SERIES allocated rather than the
                        payment, which is a separate feature. */}
                    {!a.split ? (
                      <tr className="border-b border-border/40 bg-surface/40">
                        <td colSpan={5} className="px-2 py-1.5">
                          <label className="flex items-center gap-2 text-xs text-fg-muted">
                            <input
                              type="checkbox"
                              checked={a.splitAsMortgage}
                              disabled={isMortgageRule && !a.splitAsMortgage}
                              onChange={(e) =>
                                updateRow(
                                  i,
                                  "splitAsMortgage",
                                  e.target.checked,
                                )
                              }
                            />
                            This is a mortgage payment — split it into interest
                            and principal
                            {isMortgageRule && !a.splitAsMortgage && (
                              <span className="italic">
                                (already set on line {mortgageLineIndex + 1})
                              </span>
                            )}
                          </label>
                        </td>
                      </tr>
                    ) : null}
                    {/* Rendered ONLY when this row names a company, which is
                        zero rows on any rule that existed before this shipped —
                        so nothing already set up changes appearance. */}
                    {a.scopeType === "Company" && a.scopeId ? (
                      <tr className="border-b border-border/40 bg-surface/40">
                        <td colSpan={5} className="px-2 py-1.5">
                          <SplitRow
                            index={i}
                            row={a}
                            set={companySets[a.scopeId]}
                            onToggle={(v) => updateRow(i, "split", v)}
                          />
                        </td>
                      </tr>
                    ) : null}
                    </React.Fragment>
                  ))}
                  <tr className="bg-surface">
                    <td
                      colSpan={3}
                      className="px-2 py-2 text-right text-xs font-bold uppercase tracking-widest text-fg-muted"
                    >
                      Total
                    </td>
                    <td className="px-2 py-2 text-right">
                      {/* convert={false}: this is the sum of the boxes above,
                          which are typed and stored in the rule's own
                          currency. Letting the USD/CAD display toggle rescale
                          it would show a total that disagrees with its own
                          rows — and with what actually posts. */}
                      <CurrencyAmount value={amountsTotal} convert={false} />
                    </td>
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>
            {scopeGroupCount > 1 && type !== "Journal entry" && (
              <p className="text-xs text-fg-muted">
                This rule posts to {scopeGroupCount} different places — each run
                creates {scopeGroupCount} separate {type.toLowerCase()}s, one
                for each. A split line does not add one: it stays on its
                company&rsquo;s {type.toLowerCase()}.
              </p>
            )}
          </div>

          {isMortgageRule && (
            <MortgageTerms
              value={mortgage}
              onChange={setMortgage}
              paymentCents={Math.round(
                (parseCurrencyToDollars(
                  amounts[mortgageLineIndex]?.amount ?? "",
                ) ?? 0) * 100,
              )}
              frequency={frequency}
              liabilityAccounts={liabilityAccounts}
              expenseAccounts={expenseAccounts}
            />
          )}

          <div className="flex flex-wrap gap-4 text-sm text-fg">
            {type === "Check" && (
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={queueForPrinting}
                  onChange={(e) => setQueueForPrinting(e.target.checked)}
                />
                Queue for printing
              </label>
            )}
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={active}
                onChange={(e) => setActive(e.target.checked)}
              />
              Active
            </label>
          </div>
        </div>
        <DialogFooter>
          {mode === "edit" && (
            <Button
              variant="outline"
              onClick={deleteRule}
              disabled={saving}
              className="mr-auto border-error text-error hover:bg-error/10"
            >
              Delete
            </Button>
          )}
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving…" : mode === "create" ? "Create" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Loan terms for a mortgage rule, plus a live preview of what the next payment
 * will actually post.
 *
 * The preview is the point. The client supplies "amount, rate and term", but
 * the split also depends on the origination date and the compounding
 * convention, and a wrong input produces a plausible-looking number rather than
 * an error. Showing the interest/principal split and the resulting balance next
 * to the lender's own statement figure is what makes a wrong input visible
 * before anything posts.
 */
function MortgageTerms({
  value,
  onChange,
  paymentCents,
  frequency,
  liabilityAccounts,
  expenseAccounts,
}: {
  value: MortgageForm;
  onChange: (next: MortgageForm) => void;
  paymentCents: number;
  frequency: RecurringFrequency;
  liabilityAccounts: AccountOption[];
  expenseAccounts: AccountOption[];
}) {
  const set = <K extends keyof MortgageForm>(k: K, v: MortgageForm[K]) =>
    onChange({ ...value, [k]: v });

  // Everything below is derived, never stored — the balance at any date is a
  // pure function of the terms plus the payment number.
  const preview = React.useMemo((): {
    scheduled?: number;
    first?: ReturnType<typeof amortizationAt>;
    error?: string;
  } | null => {
    const principal = Math.round(Number(value.originalPrincipal) * 100);
    const rate = Number(value.annualRatePct);
    const term = Number(value.termPeriods);
    if (!value.originationDate || !principal || !term || Number.isNaN(rate)) {
      return null;
    }
    let periodsPerYear: number;
    try {
      periodsPerYear = periodsPerYearFor(frequency);
    } catch (e) {
      return { error: (e as Error).message };
    }
    const terms = {
      originalPrincipalCents: principal,
      annualRatePct: rate,
      termPeriods: term,
      periodsPerYear,
      compounding: value.compounding,
    };
    try {
      const scheduled = derivePaymentCents(terms);
      if (!paymentCents) return { scheduled };
      return {
        scheduled,
        first: amortizationAt({ ...terms, paymentCents }, 1),
      };
    } catch (e) {
      return { error: (e as Error).message };
    }
  }, [
    value.originationDate,
    value.originalPrincipal,
    value.annualRatePct,
    value.termPeriods,
    value.compounding,
    paymentCents,
    frequency,
  ]);

  // A large gap between the entered payment and the annuity payment means one
  // of the four inputs is wrong. Advisory, not blocking — the entered payment
  // is what actually leaves the bank and must stay authoritative.
  const drift =
    preview?.scheduled && paymentCents
      ? Math.abs(paymentCents - preview.scheduled)
      : 0;
  const driftMatters = drift > Math.max(500, Math.round(paymentCents * 0.01));

  return (
    <div className="space-y-3 rounded border border-border bg-surface/40 p-3">
      <div className="text-xs font-bold uppercase tracking-widest text-fg-muted">
        Mortgage terms
      </div>
      <p className="text-xs text-fg-muted">
        The payment above is what leaves the bank and is never recalculated —
        only its split into interest and principal is computed. Interest is
        charged to the expense account below; principal reduces the loan.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="mtg-origination">Origination date</Label>
          <Input
            id="mtg-origination"
            type="date"
            value={value.originationDate}
            onChange={(e) => set("originationDate", e.target.value)}
          />
          <p className="mt-1 text-[11px] text-fg-muted">
            The date the loan started, not the date it was entered here. Payment
            numbers are counted from it.
          </p>
        </div>
        <div>
          <Label htmlFor="mtg-principal">Original loan amount</Label>
          <Input
            id="mtg-principal"
            type="text"
            inputMode="decimal"
            placeholder="0.00"
            value={value.originalPrincipal}
            onChange={(e) => set("originalPrincipal", e.target.value)}
          />
          <p className="mt-1 text-[11px] text-fg-muted">
            The amount borrowed at the start — not the monthly payment, and not
            the balance today.
          </p>
        </div>
        <div>
          <Label htmlFor="mtg-rate">Annual interest rate (%)</Label>
          <Input
            id="mtg-rate"
            type="number"
            step="0.001"
            value={value.annualRatePct}
            onChange={(e) => set("annualRatePct", e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="mtg-term">Amortization (number of payments)</Label>
          <Input
            id="mtg-term"
            type="number"
            value={value.termPeriods}
            onChange={(e) => set("termPeriods", e.target.value)}
          />
          <p className="mt-1 text-[11px] text-fg-muted">
            300 = 25 years of monthly payments.
          </p>
        </div>
        <div>
          <Label htmlFor="mtg-compounding">Compounding</Label>
          <select
            id="mtg-compounding"
            className="w-full rounded border border-border bg-surface px-2 py-1 text-sm text-fg"
            value={value.compounding}
            onChange={(e) =>
              set("compounding", e.target.value as MortgageForm["compounding"])
            }
          >
            <option value="SemiAnnual">Semi-annual (Canadian)</option>
            <option value="PeriodMatched">Monthly (US)</option>
          </select>
          <p className="mt-1 text-[11px] text-fg-muted">
            Canadian mortgages compound semi-annually by law. Check a lender
            statement — the two differ by roughly $1,300 over a $1M 25-year term.
          </p>
        </div>
        <div>
          <Label htmlFor="mtg-already">Payments already made (optional)</Label>
          <Input
            id="mtg-already"
            type="number"
            value={value.paymentsAlreadyMade}
            onChange={(e) => set("paymentsAlreadyMade", e.target.value)}
          />
          <p className="mt-1 text-[11px] text-fg-muted">
            Only if the true origination date is unavailable. Prefer the date.
          </p>
        </div>
        <div>
          <Label htmlFor="mtg-interest-acct">Interest account (expense)</Label>
          <select
            id="mtg-interest-acct"
            className="w-full rounded border border-border bg-surface px-2 py-1 text-sm text-fg"
            value={value.interestAccountId}
            onChange={(e) => set("interestAccountId", e.target.value)}
          >
            <option value="">Choose…</option>
            {expenseAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="mtg-principal-acct">
            Principal account (long-term liability)
          </Label>
          <select
            id="mtg-principal-acct"
            className="w-full rounded border border-border bg-surface px-2 py-1 text-sm text-fg"
            value={value.principalAccountId}
            onChange={(e) => set("principalAccountId", e.target.value)}
          >
            <option value="">Choose…</option>
            {liabilityAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          {liabilityAccounts.length === 0 && (
            <p className="mt-1 text-[11px] text-warning">
              No long-term liability account exists yet. Open Accounting → Chart
              of accounts once to create Mortgage Payable.
            </p>
          )}
        </div>
        <div>
          <Label htmlFor="mtg-stmt-balance">
            Lender statement balance (optional)
          </Label>
          <Input
            id="mtg-stmt-balance"
            type="text"
            inputMode="decimal"
            placeholder="0.00"
            value={value.statementBalance}
            onChange={(e) => set("statementBalance", e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="mtg-stmt-date">…as at</Label>
          <Input
            id="mtg-stmt-date"
            type="date"
            value={value.statementDate}
            onChange={(e) => set("statementDate", e.target.value)}
          />
          <p className="mt-1 text-[11px] text-fg-muted">
            Recorded as a check, never used in a calculation. If our schedule
            disagrees with the lender by more than a few dollars, the terms are
            wrong.
          </p>
        </div>
      </div>

      {preview?.error && (
        <p className="rounded border border-loss/40 bg-loss/10 px-2 py-1.5 text-xs text-fg">
          {preview.error}
        </p>
      )}

      {preview?.first && (
        <div className="rounded border border-border bg-bg-elevated px-2 py-1.5 text-xs text-fg">
          <span className="font-bold">First payment splits as</span> interest{" "}
          <CurrencyAmount cents={preview.first.interestCents} convert={false} />{" "}
          + principal{" "}
          <CurrencyAmount
            cents={preview.first.principalCents}
            convert={false}
          />
          , leaving a balance of{" "}
          <CurrencyAmount
            cents={preview.first.closingBalanceCents}
            convert={false}
          />
          .
        </div>
      )}

      {driftMatters && preview?.scheduled != null && (
        <p className="rounded border border-warning/40 bg-warning/10 px-2 py-1.5 text-xs text-fg">
          These terms imply a payment of{" "}
          <CurrencyAmount cents={preview.scheduled} convert={false} />, but the
          line above says{" "}
          <CurrencyAmount cents={paymentCents} convert={false} />. The entered
          payment is what will post — but a gap this size usually means the
          principal, rate, term or compounding is wrong.
        </p>
      )}
    </div>
  );
}
