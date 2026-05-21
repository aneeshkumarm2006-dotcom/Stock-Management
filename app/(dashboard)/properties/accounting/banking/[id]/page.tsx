// /properties/accounting/banking/[id] — bank-account detail.
// Phase 2 wires the Register tab to real JE data. Reconciliation tab stays
// ComingSoon (Phase 9 bank-feed wizard, BR-AC-17).
"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, useRouter, notFound } from "next/navigation";
import { AlertTriangle, ArrowLeft, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { ComingSoon } from "@/components/pm/ComingSoon";
import { useToast } from "@/components/ui/toast";
import { CurrencyAmount } from "@/components/pm/CurrencyAmount";
import { fromCents } from "@/lib/pm/currency";
import type { BankAccountType } from "@/types/pm";

interface Detail {
  id: string;
  name: string;
  purpose: string;
  accountNumberMasked: string;
  type: BankAccountType;
  epayEnabled: boolean;
  retailCashEnabled: boolean;
  lastReconciliationDate: string | null;
  isCompanyCash: boolean;
  isDefault: boolean;
  chartOfAccountId: string | null;
  active: boolean;
  balance: number;
  undepositedFunds: boolean;
}

export default function BankAccountDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { toast } = useToast();
  const [doc, setDoc] = React.useState<Detail | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [archiving, setArchiving] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    fetch(`/api/pm/bank-accounts/${id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled) return;
        if (d) setDoc(d as Detail);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loading) {
    return <p className="text-sm text-fg-muted">Loading…</p>;
  }
  if (!doc) return notFound();

  async function archive() {
    setArchiving(true);
    const res = await fetch(`/api/pm/bank-accounts/${id}`, { method: "DELETE" });
    setArchiving(false);
    if (!res.ok) {
      toast({ title: "Archive failed", variant: "error" });
      return;
    }
    toast({ title: "Archived", variant: "success" });
    router.push("/properties/accounting/banking");
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push("/properties/accounting/banking")}
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Banking
        </Button>
        <Button
          variant="destructive"
          size="sm"
          onClick={archive}
          disabled={archiving || !doc.active}
        >
          {doc.active ? "Inactivate" : "Inactive"}
        </Button>
      </div>

      {doc.undepositedFunds && (
        <Card className="border-warning bg-warning/5">
          <CardContent className="flex items-center gap-2 py-3 text-sm text-warning">
            <AlertTriangle className="h-4 w-4" />
            Undeposited funds present — receipts have not yet been rolled into
            a deposit (BR-AC-7).
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{doc.name}</CardTitle>
          <span className="text-xs italic text-fg-muted">{doc.purpose || ""}</span>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-3 md:grid-cols-2">
            <Field label="Type" value={doc.type} />
            <Field label="Account number" value={doc.accountNumberMasked} mono />
            <Field
              label="ePay enabled"
              value={doc.epayEnabled ? "Yes" : "No"}
            />
            <Field
              label="Retail cash enabled"
              value={doc.retailCashEnabled ? "Yes" : "No"}
            />
            <Field
              label="Company cash"
              value={doc.isCompanyCash ? "Yes" : "No"}
            />
            <Field label="Default" value={doc.isDefault ? "Yes" : "No"} />
            <Field
              label="Last reconciled"
              value={
                doc.lastReconciliationDate
                  ? new Date(doc.lastReconciliationDate).toLocaleDateString()
                  : "Never"
              }
            />
            <Field
              label="Balance"
              value={`${doc.chartOfAccountId ? "" : "Unmapped — "}${fromCents(doc.balance).toFixed(2)}`}
              mono
            />
          </dl>
        </CardContent>
      </Card>

      <Tabs defaultValue="register">
        <TabsList>
          <TabsTrigger value="register">Register</TabsTrigger>
          <TabsTrigger value="reconciliation">Reconciliation</TabsTrigger>
        </TabsList>
        <TabsContent value="register">
          {doc.chartOfAccountId ? (
            <BankRegister chartOfAccountId={doc.chartOfAccountId} />
          ) : (
            <Card className="border-warning">
              <CardContent className="space-y-2 py-3 text-sm">
                <p className="font-medium text-warning">
                  No GL cash account mapped.
                </p>
                <p className="text-fg-muted">
                  Set <code className="rounded bg-surface-high px-1">chartOfAccountId</code> on this bank account to enable register reads. The register sums JE lines posted to the linked Chart of Accounts row.
                </p>
              </CardContent>
            </Card>
          )}
        </TabsContent>
        <TabsContent value="reconciliation">
          <ComingSoon
            title="Reconciliation"
            description="Bank-feed reconciliation wizard ships in Phase 9 (BR-AC-17)."
          />
        </TabsContent>
      </Tabs>

      <p className="flex items-center gap-1 text-xs text-fg-muted">
        <Lock className="h-3 w-3" />
        Account numbers are masked everywhere per BR-AC-13.
      </p>
    </div>
  );
}

function Field({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-widest text-fg-muted">{label}</dt>
      <dd className={"text-sm text-fg " + (mono ? "tabular-nums" : "")}>{value}</dd>
    </div>
  );
}

interface RegisterRow {
  journalEntryId: string;
  date: string;
  memo: string;
  description: string;
  debit: number;
  credit: number;
  status: "Posted" | "Draft" | "Voided";
  net: number;
}

function BankRegister({ chartOfAccountId }: { chartOfAccountId: string }) {
  const [rows, setRows] = React.useState<RegisterRow[]>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    setLoading(true);
    fetch(`/api/pm/journal-entries?accountId=${chartOfAccountId}&limit=200`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data: Array<{
        id: string;
        date: string;
        memo: string;
        status: "Posted" | "Draft" | "Voided";
        lines: Array<{ accountId: string; debit: number; credit: number; description: string }>;
      }>) => {
        // Flatten each JE into one register row per matching line.
        const out: RegisterRow[] = [];
        let running = 0;
        for (const je of [...data].reverse()) {
          for (const line of je.lines) {
            if (line.accountId !== chartOfAccountId) continue;
            const net = line.debit - line.credit;
            if (je.status === "Posted") running += net;
            out.push({
              journalEntryId: je.id,
              date: je.date,
              memo: je.memo,
              description: line.description,
              debit: line.debit,
              credit: line.credit,
              status: je.status,
              net: running,
            });
          }
        }
        setRows(out.reverse()); // most recent first for display
      })
      .finally(() => setLoading(false));
  }, [chartOfAccountId]);

  if (loading) return <p className="text-sm text-fg-muted">Loading register…</p>;
  if (rows.length === 0)
    return (
      <p className="text-sm text-fg-muted">
        No journal entry lines reference this account yet.
      </p>
    );

  return (
    <Card>
      <CardContent className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-surface text-left text-xs uppercase tracking-widest text-fg-muted">
            <tr>
              <th className="px-2 py-2">Date</th>
              <th>Memo</th>
              <th>Description</th>
              <th className="text-right">Debit</th>
              <th className="text-right">Credit</th>
              <th className="text-right">Running</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr
                key={i}
                className={
                  "border-b border-border/30 " +
                  (r.status === "Voided" ? "opacity-50 line-through" : "")
                }
              >
                <td className="px-2 py-1 tabular-nums">
                  <Link
                    href={`/properties/accounting/general-ledger/${r.journalEntryId}`}
                    className="hover:underline"
                  >
                    {new Date(r.date).toLocaleDateString()}
                  </Link>
                </td>
                <td className="text-fg-muted">{r.memo || "—"}</td>
                <td className="text-fg-muted">{r.description || "—"}</td>
                <td className="px-2 py-1 text-right">
                  {r.debit > 0 ? <CurrencyAmount value={fromCents(r.debit)} /> : "—"}
                </td>
                <td className="px-2 py-1 text-right">
                  {r.credit > 0 ? <CurrencyAmount value={fromCents(r.credit)} /> : "—"}
                </td>
                <td className="px-2 py-1 text-right">
                  <CurrencyAmount value={fromCents(r.net)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
