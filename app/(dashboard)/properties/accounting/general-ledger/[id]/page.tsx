// /properties/accounting/general-ledger/[id] — single Journal Entry detail.
// Shows the full line grid; offers Void (BR-AC-3 — FinancialAdmin override on
// locked periods) which writes a reversing JE. Posted entries are immutable;
// Drafts (if any) can route to an edit modal later.
"use client";

import * as React from "react";
import { useParams, notFound } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { CurrencyAmount } from "@/components/pm/CurrencyAmount";
import { fromCents } from "@/lib/pm/currency";

interface JELine {
  accountId: string;
  scopeType: "Property" | "Company";
  scopeId: string | null;
  name: string;
  description: string;
  debit: number;
  credit: number;
}

interface JEDetail {
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
  voidedAt: string | null;
  postedAt: string | null;
}

interface AccountOption {
  id: string;
  name: string;
}
interface PropertyOption {
  id: string;
  name: string;
}

export default function JournalEntryDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const [doc, setDoc] = React.useState<JEDetail | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [voiding, setVoiding] = React.useState(false);
  const [accounts, setAccounts] = React.useState<AccountOption[]>([]);
  const [properties, setProperties] = React.useState<PropertyOption[]>([]);

  const load = React.useCallback(async () => {
    setLoading(true);
    const r = await fetch(`/api/pm/journal-entries/${id}`);
    if (r.ok) setDoc((await r.json()) as JEDetail);
    else setDoc(null);
    setLoading(false);
  }, [id]);

  React.useEffect(() => {
    load();
    Promise.all([
      fetch("/api/pm/chart-of-accounts").then((r) => (r.ok ? r.json() : [])),
      fetch("/api/pm/properties").then((r) => (r.ok ? r.json() : [])),
    ]).then(([a, p]) => {
      setAccounts(a as AccountOption[]);
      setProperties(
        (p as { id: string; propertyName: string }[]).map((row) => ({
          id: row.id,
          name: row.propertyName,
        })),
      );
    });
  }, [load]);

  if (loading) return <p className="text-sm text-fg-muted">Loading…</p>;
  if (!doc) return notFound();

  const accountName = (id: string) =>
    accounts.find((a) => a.id === id)?.name ?? "—";
  const propertyName = (id: string | null) =>
    id ? properties.find((p) => p.id === id)?.name ?? "Property" : "Company";

  async function voidEntry() {
    if (!doc) return;
    if (doc.status === "Voided") return;
    if (!confirm(
        doc.status === "Posted"
          ? "Void this entry? A reversing journal entry will be posted automatically."
          : "Void this draft?",
      )
    ) return;
    setVoiding(true);
    const res = await fetch(`/api/pm/journal-entries/${id}/void`, {
      method: "POST",
    });
    setVoiding(false);
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      toast({ title: "Void failed", description: err.error, variant: "error" });
      return;
    }
    toast({ title: "Entry voided", variant: "success" });
    await load();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Link
          href="/properties/accounting/general-ledger"
          className="flex items-center gap-1 text-sm text-fg-muted hover:text-fg"
        >
          <ArrowLeft className="h-4 w-4" /> General ledger
        </Link>
        {doc.status !== "Voided" && (
          <Button variant="outline" size="sm" onClick={voidEntry} disabled={voiding}>
            <XCircle className="h-3.5 w-3.5" />{" "}
            {voiding ? "Voiding…" : "Void entry"}
          </Button>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            Journal entry · {new Date(doc.date).toLocaleDateString()}
          </CardTitle>
          <StatusBadge status={doc.status} />
        </CardHeader>
        <CardContent className="space-y-3">
          {doc.reversesJournalEntryId && (
            <div className="flex items-center gap-2 rounded border border-warning/40 bg-warning/10 p-2 text-xs text-warning">
              <AlertTriangle className="h-4 w-4" />
              <span>
                Reversal of{" "}
                <Link
                  href={`/properties/accounting/general-ledger/${doc.reversesJournalEntryId}`}
                  className="underline"
                >
                  earlier entry
                </Link>
              </span>
            </div>
          )}
          {doc.reversedByJournalEntryId && (
            <div className="flex items-center gap-2 rounded border border-error/40 bg-error/10 p-2 text-xs text-error">
              <AlertTriangle className="h-4 w-4" />
              <span>
                Voided — reversal posted as{" "}
                <Link
                  href={`/properties/accounting/general-ledger/${doc.reversedByJournalEntryId}`}
                  className="underline"
                >
                  separate entry
                </Link>
              </span>
            </div>
          )}
          <dl className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
            <Field label="Scope">
              {doc.scopeType === "Property" && doc.scopeId
                ? propertyName(doc.scopeId)
                : "Company"}
            </Field>
            <Field label="Memo">{doc.memo || "—"}</Field>
            <Field label="Posted at">
              {doc.postedAt
                ? new Date(doc.postedAt).toLocaleString()
                : "—"}
            </Field>
            <Field label="Voided at">
              {doc.voidedAt
                ? new Date(doc.voidedAt).toLocaleString()
                : "—"}
            </Field>
          </dl>

          <div className="overflow-x-auto rounded border border-border">
            <table className="w-full text-sm">
              <thead className="border-b border-border text-left text-xs uppercase tracking-widest text-fg-muted">
                <tr>
                  <th className="px-2 py-2">Account</th>
                  <th>Scope</th>
                  <th>Description</th>
                  <th className="text-right">Debit</th>
                  <th className="text-right">Credit</th>
                </tr>
              </thead>
              <tbody>
                {doc.lines.map((l, i) => (
                  <tr key={i} className="border-b border-border/30">
                    <td className="px-2 py-1">{accountName(l.accountId)}</td>
                    <td className="px-2 py-1 text-fg-muted">
                      {l.scopeType === "Property" && l.scopeId
                        ? propertyName(l.scopeId)
                        : "Company"}
                    </td>
                    <td className="px-2 py-1 text-fg-muted">
                      {l.description || "—"}
                    </td>
                    <td className="px-2 py-1 text-right">
                      <CurrencyAmount value={fromCents(l.debit)} />
                    </td>
                    <td className="px-2 py-1 text-right">
                      <CurrencyAmount value={fromCents(l.credit)} />
                    </td>
                  </tr>
                ))}
                <tr className="bg-surface">
                  <td colSpan={3} className="px-2 py-2 text-right text-xs font-bold uppercase tracking-widest text-fg-muted">
                    Totals
                  </td>
                  <td className="px-2 py-2 text-right">
                    <CurrencyAmount value={fromCents(doc.totalDebits)} />
                  </td>
                  <td className="px-2 py-2 text-right">
                    <CurrencyAmount value={fromCents(doc.totalCredits)} />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-widest text-fg-muted">
        {label}
      </dt>
      <dd className="text-fg">{children}</dd>
    </div>
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
    <span className={"rounded px-2 py-0.5 text-xs font-bold uppercase " + cls}>
      {status}
    </span>
  );
}
