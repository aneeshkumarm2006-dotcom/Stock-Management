// /properties/accounting/general-ledger — GL journal entries view.
//
// Filter bar (Account / Property / Date range / Status) drives a list of
// recent entries; each row expands to show its lines. "+ Add general
// journal entry" opens the shared JournalEntryModal. Drill-through links
// from the Financials matrix land here with the matching filters
// pre-applied via query params (BR-AC-15).
"use client";

import * as React from "react";
import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ChevronDown, ChevronRight, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CurrencyAmount } from "@/components/pm/CurrencyAmount";
import { JournalEntryModal } from "@/components/pm/JournalEntryModal";
import type { PmCurrency } from "@/types/pm";
import { formatDateOnly } from "@/lib/utils/dateInput";

interface JELine {
  accountId: string;
  scopeType: "Property" | "Company";
  scopeId: string | null;
  unitId: string | null;
  name: string;
  description: string;
  debit: number; // cents
  credit: number; // cents
}

interface JERow {
  id: string;
  date: string;
  scopeType: "Property" | "Company";
  scopeId: string | null;
  memo: string;
  lines: JELine[];
  totalDebits: number;
  totalCredits: number;
  status: "Posted" | "Draft" | "Voided";
  reversesJournalEntryId: string | null;
  reversedByJournalEntryId: string | null;
  createdAt: string;
}

interface AccountOption {
  id: string;
  name: string;
  type: string;
}

interface PropertyOption {
  id: string;
  name: string;
  /** null when the property inherits the org default. */
  currency: PmCurrency | null;
}

interface CompanyOption {
  id: string;
  name: string;
}

function GeneralLedgerContent() {
  const searchParams = useSearchParams();
  const [accounts, setAccounts] = React.useState<AccountOption[]>([]);
  const [properties, setProperties] = React.useState<PropertyOption[]>([]);
  const [rows, setRows] = React.useState<JERow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [modalOpen, setModalOpen] = React.useState(false);
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());

  const [companies, setCompanies] = React.useState<CompanyOption[]>([]);

  const [filter, setFilter] = React.useState({
    accountId: searchParams.get("accountId") ?? "",
    propertyId: searchParams.get("propertyId") ?? "",
    // Drill-through from a Financials company column. "none" is the legacy
    // bucket (Company-scoped lines carrying no company) — a narrower question
    // than "any company", so it is kept distinct from "".
    companyId: searchParams.get("companyId") ?? "",
    from: searchParams.get("from") ?? "",
    to: searchParams.get("to") ?? "",
    status: searchParams.get("status") ?? "",
    includeVoided: searchParams.get("includeVoided") === "1",
  });

  // Load reference data once.
  React.useEffect(() => {
    Promise.all([
      fetch("/api/pm/chart-of-accounts").then((r) => (r.ok ? r.json() : [])),
      fetch("/api/pm/properties").then((r) => (r.ok ? r.json() : [])),
      fetch("/api/pm/company-accounts").then((r) => (r.ok ? r.json() : [])),
    ]).then(([a, p, c]) => {
      setAccounts(a as AccountOption[]);
      setCompanies(c as CompanyOption[]);
      setProperties(
        (
          p as {
            id: string;
            propertyName: string;
            currency: PmCurrency | null;
          }[]
        ).map((row) => ({
          id: row.id,
          name: row.propertyName,
          currency: row.currency ?? null,
        })),
      );
    });
  }, []);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (filter.accountId) params.set("accountId", filter.accountId);
    if (filter.propertyId) params.set("propertyId", filter.propertyId);
    if (filter.companyId) params.set("companyId", filter.companyId);
    if (filter.from) params.set("from", filter.from);
    if (filter.to) params.set("to", filter.to);
    if (filter.status) params.set("status", filter.status);
    if (filter.includeVoided) params.set("includeVoided", "1");
    try {
      const r = await fetch(`/api/pm/journal-entries?${params.toString()}`);
      if (r.ok) setRows((await r.json()) as JERow[]);
      else setError(`Error ${r.status}`);
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }, [filter]);

  React.useEffect(() => {
    load();
  }, [load]);

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const accountNameById = React.useMemo(() => {
    const m = new Map<string, string>();
    for (const a of accounts) m.set(a.id, a.name);
    return m;
  }, [accounts]);
  const propertyNameById = React.useMemo(() => {
    const m = new Map<string, string>();
    for (const p of properties) m.set(p.id, p.name);
    return m;
  }, [properties]);
  const companyNameById = React.useMemo(() => {
    const m = new Map<string, string>();
    for (const c of companies) m.set(c.id, c.name);
    return m;
  }, [companies]);
  /**
   * The scope label for an entry or a line.
   *
   * A Company scope carrying a real CompanyAccount id used to render as the
   * bare literal "Company" — indistinguishable from the legacy no-company
   * bucket, and from every OTHER company. That is exactly the confusion the
   * recurring-transactions list already avoids by resolving the name, and it
   * matters more now that the Financials matrix gives each company its own
   * column: a row drilled from the Greene column must say Greene.
   */
  const scopeLabel = React.useCallback(
    (scopeType: string, scopeId: string | null): string => {
      if (scopeType === "Property" && scopeId) {
        return propertyNameById.get(scopeId) ?? "Property";
      }
      if (scopeType === "Company" && scopeId) {
        return companyNameById.get(scopeId) ?? "Unknown company";
      }
      return "Company (unassigned)";
    },
    [propertyNameById, companyNameById],
  );
  // A journal entry is denominated in its scope's currency. This is the
  // drill-through target of every Financials cell, so rendering a USD entry
  // under a C$ symbol here would undo the fix one click later. Company-scoped
  // entries fall through to the provider's org default.
  const currencyForScope = React.useCallback(
    (scopeType: string, scopeId: string | null): PmCurrency | undefined => {
      if (scopeType !== "Property" || !scopeId) return undefined;
      return properties.find((p) => p.id === scopeId)?.currency ?? undefined;
    },
    [properties],
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>General ledger</CardTitle>
          <Button size="sm" onClick={() => setModalOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> Add general journal entry
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-5">
            <div className="space-y-1">
              <Label>Account</Label>
              <select
                value={filter.accountId}
                onChange={(e) =>
                  setFilter({ ...filter, accountId: e.target.value })
                }
                className="h-9 w-full rounded border border-border bg-surface-highest px-2 text-sm text-fg"
              >
                <option value="">All accounts</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label>Property or company</Label>
              <select
                value={
                  filter.propertyId
                    ? `property:${filter.propertyId}`
                    : filter.companyId
                      ? `company:${filter.companyId}`
                      : ""
                }
                onChange={(e) => {
                  // One control, two mutually exclusive filters — picking a
                  // company must clear the property and vice versa, or the API
                  // would receive both and silently prefer the property.
                  const v = e.target.value;
                  setFilter({
                    ...filter,
                    propertyId: v.startsWith("property:") ? v.slice(9) : "",
                    companyId: v.startsWith("company:") ? v.slice(8) : "",
                  });
                }}
                className="h-9 w-full rounded border border-border bg-surface-highest px-2 text-sm text-fg"
              >
                <option value="">All properties &amp; companies</option>
                {properties.map((p) => (
                  <option key={p.id} value={`property:${p.id}`}>
                    {p.name}
                  </option>
                ))}
                {companies.map((c) => (
                  <option key={c.id} value={`company:${c.id}`}>
                    {c.name} (Co.)
                  </option>
                ))}
                <option value="company:none">Company (unassigned)</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label>From</Label>
              <Input
                type="date"
                value={filter.from}
                onChange={(e) => setFilter({ ...filter, from: e.target.value })}
                className="h-9"
              />
            </div>
            <div className="space-y-1">
              <Label>To</Label>
              <Input
                type="date"
                value={filter.to}
                onChange={(e) => setFilter({ ...filter, to: e.target.value })}
                className="h-9"
              />
            </div>
            <div className="space-y-1">
              <Label>Status</Label>
              <select
                value={filter.status}
                onChange={(e) =>
                  setFilter({ ...filter, status: e.target.value })
                }
                className="h-9 w-full rounded border border-border bg-surface-highest px-2 text-sm text-fg"
              >
                <option value="">Posted + Draft</option>
                <option value="Posted">Posted</option>
                <option value="Draft">Draft</option>
                <option value="Voided">Voided</option>
              </select>
            </div>
          </div>
          <div className="flex items-center justify-between text-xs text-fg-muted">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={filter.includeVoided}
                onChange={(e) =>
                  setFilter({ ...filter, includeVoided: e.target.checked })
                }
              />
              Include voided entries
            </label>
            <span className="rounded-full border border-border bg-surface px-2 py-0.5 font-bold">
              ({rows.length})
            </span>
          </div>

          {error && (
            <div className="rounded border border-error/40 bg-error/10 px-3 py-2 text-sm text-error">
              {error} — could not load journal entries.{" "}
              <button
                type="button"
                onClick={() => load()}
                className="font-bold underline"
              >
                Retry
              </button>
            </div>
          )}
          {loading && <p className="text-sm text-fg-muted">Loading…</p>}
          {!loading && !error && rows.length === 0 && (
            <p className="text-sm text-fg-muted">
              No journal entries match the current filters.
            </p>
          )}
          {!loading && rows.length > 0 && (
            <div className="overflow-x-auto rounded border border-border">
              <table className="w-full text-sm">
                <thead className="border-b border-border text-left text-xs uppercase tracking-widest text-fg-muted">
                  <tr>
                    <th className="w-8 py-2"></th>
                    <th className="py-2">Date</th>
                    <th>Scope</th>
                    <th>Memo</th>
                    <th>Status</th>
                    <th className="text-right">Debits</th>
                    <th className="text-right">Credits</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <React.Fragment key={r.id}>
                      <tr
                        className={
                          "cursor-pointer border-b border-border/40 hover:bg-surface-high " +
                          (r.status === "Voided"
                            ? "line-through opacity-50"
                            : "")
                        }
                        onClick={() => toggleExpand(r.id)}
                      >
                        <td className="py-2 text-fg-muted">
                          {expanded.has(r.id) ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </td>
                        <td className="py-2 tabular-nums">
                          <Link
                            href={`/properties/accounting/general-ledger/${r.id}`}
                            onClick={(e) => e.stopPropagation()}
                            className="hover:underline"
                          >
                            {formatDateOnly(r.date)}
                          </Link>
                        </td>
                        <td className="text-fg-muted">
                          {scopeLabel(r.scopeType, r.scopeId)}
                        </td>
                        <td className="text-fg-muted">{r.memo || "—"}</td>
                        <td>
                          <StatusBadge status={r.status} />
                        </td>
                        <td className="text-right">
                          <CurrencyAmount
                            cents={r.totalDebits}
                            currency={currencyForScope(r.scopeType, r.scopeId)}
                            convert={false}
                          />
                        </td>
                        <td className="text-right">
                          <CurrencyAmount
                            cents={r.totalCredits}
                            currency={currencyForScope(r.scopeType, r.scopeId)}
                            convert={false}
                          />
                        </td>
                      </tr>
                      {expanded.has(r.id) && (
                        <tr className="bg-surface">
                          <td />
                          <td colSpan={6} className="py-2">
                            <table className="w-full text-xs">
                              <thead className="text-left text-fg-muted">
                                <tr>
                                  <th className="pb-1">Account</th>
                                  <th>Scope</th>
                                  <th>Description</th>
                                  <th className="text-right">Debit</th>
                                  <th className="text-right">Credit</th>
                                </tr>
                              </thead>
                              <tbody>
                                {r.lines.map((l, i) => (
                                  <tr
                                    key={i}
                                    className="border-t border-border/30"
                                  >
                                    <td className="py-1">
                                      {accountNameById.get(l.accountId) ?? "—"}
                                    </td>
                                    <td className="text-fg-muted">
                                      {scopeLabel(l.scopeType, l.scopeId)}
                                    </td>
                                    <td className="text-fg-muted">
                                      {l.description || "—"}
                                    </td>
                                    <td className="text-right">
                                      <CurrencyAmount
                                        cents={l.debit}
                                        currency={currencyForScope(
                                          l.scopeType,
                                          l.scopeId,
                                        )}
                                        convert={false}
                                      />
                                    </td>
                                    <td className="text-right">
                                      <CurrencyAmount
                                        cents={l.credit}
                                        currency={currencyForScope(
                                          l.scopeType,
                                          l.scopeId,
                                        )}
                                        convert={false}
                                      />
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
      <JournalEntryModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSaved={load}
      />
    </div>
  );
}

export default function GeneralLedgerPage() {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-fg-muted" />
        </div>
      }
    >
      <GeneralLedgerContent />
    </Suspense>
  );
}

function StatusBadge({ status }: { status: "Posted" | "Draft" | "Voided" }) {
  const cls =
    status === "Posted"
      ? "bg-success/15 text-success"
      : status === "Draft"
        ? "bg-warning/15 text-warning"
        : "bg-error/15 text-error";
  return (
    <span
      className={"rounded px-1.5 py-0.5 text-[10px] font-bold uppercase " + cls}
    >
      {status}
    </span>
  );
}
