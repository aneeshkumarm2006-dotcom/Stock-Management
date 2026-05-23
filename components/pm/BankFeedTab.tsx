// Bank feed tab on the bank-account detail page (PDR §3.27b,
// DECISIONS.md [G-S-33]). Lists the imported feed rows + offers
// "Match" / "Ignore" actions. Auto-suggests journal lines that match
// on amount within ±2 days.
"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { CurrencyAmount } from "@/components/pm/CurrencyAmount";
import { BankFeedImportModal } from "@/components/pm/BankFeedImportModal";

interface FeedRow {
  id: string;
  source: "CSV" | "OFX";
  txnDate: string;
  description: string;
  amountCents: number;
  status: "Unmatched" | "Matched" | "Ignored";
  externalRef: string | null;
  suggestions: Array<{
    journalEntryId: string;
    lineId: string;
    memo: string;
    date: string;
    debit: number;
    credit: number;
  }>;
}

type StatusFilter = "Unmatched" | "Matched" | "Ignored" | "all";

interface BankFeedTabProps {
  bankAccountId: string;
}

export function BankFeedTab({ bankAccountId }: BankFeedTabProps) {
  const { toast } = useToast();
  const [rows, setRows] = React.useState<FeedRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [filter, setFilter] = React.useState<StatusFilter>("Unmatched");
  const [importOpen, setImportOpen] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    const r = await fetch(
      `/api/pm/bank-feed-transactions?bankAccountId=${bankAccountId}`,
    );
    if (r.ok) setRows((await r.json()) as FeedRow[]);
    setLoading(false);
  }, [bankAccountId]);

  React.useEffect(() => {
    load();
  }, [load]);

  async function matchRow(
    row: FeedRow,
    journalEntryId: string,
    lineId: string,
  ) {
    const r = await fetch(`/api/pm/bank-feed-transactions/${row.id}/match`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ journalEntryId, lineId }),
    });
    if (!r.ok) {
      const body = (await r.json().catch(() => ({}))) as { error?: string };
      toast({
        title: body.error ?? "Match failed",
        variant: "error",
      });
      return;
    }
    toast({ title: "Matched", variant: "success" });
    await load();
  }

  async function ignoreRow(row: FeedRow) {
    const r = await fetch(`/api/pm/bank-feed-transactions/${row.id}/match`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ignore: true }),
    });
    if (!r.ok) return;
    toast({ title: "Ignored", variant: "success" });
    await load();
  }

  const visible = React.useMemo(() => {
    if (filter === "all") return rows;
    return rows.filter((r) => r.status === filter);
  }, [rows, filter]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Bank feed</CardTitle>
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" onClick={() => setImportOpen(true)}>
            Import statement
          </Button>
          {(
            [
              ["Unmatched", "Unmatched"],
              ["Matched", "Matched"],
              ["Ignored", "Ignored"],
              ["all", "All"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={
                "rounded-full border px-3 py-1 text-xs font-bold " +
                (filter === key
                  ? "border-primary bg-primary text-primary-fg"
                  : "border-border text-fg-muted hover:text-fg")
              }
            >
              {label}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-fg-muted">Loading…</p>
        ) : visible.length === 0 ? (
          <p className="text-sm text-fg-muted">
            No feed rows in this view. Import a CSV or OFX statement to get
            started.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-xs uppercase tracking-widest text-fg-muted">
              <tr>
                <th className="py-2">Date</th>
                <th>Description</th>
                <th className="text-right">Amount</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr
                  key={r.id}
                  className={
                    "border-b border-border/40 " +
                    (r.status === "Ignored" ? "opacity-60" : "")
                  }
                >
                  <td className="py-1.5">
                    {new Date(r.txnDate).toISOString().slice(0, 10)}
                  </td>
                  <td>{r.description}</td>
                  <td className="text-right tabular-nums">
                    <CurrencyAmount cents={r.amountCents} />
                  </td>
                  <td>
                    <span
                      className={
                        "rounded px-1.5 py-0.5 text-[10px] font-bold uppercase " +
                        (r.status === "Matched"
                          ? "bg-success/10 text-success"
                          : r.status === "Ignored"
                            ? "bg-surface-high text-fg-muted"
                            : "bg-warning/10 text-warning")
                      }
                    >
                      {r.status}
                    </span>
                  </td>
                  <td className="text-right">
                    {r.status === "Unmatched" && (
                      <div className="flex justify-end gap-1.5">
                        {r.suggestions.length > 0 ? (
                          <button
                            onClick={() =>
                              matchRow(
                                r,
                                r.suggestions[0]!.journalEntryId,
                                r.suggestions[0]!.lineId,
                              )
                            }
                            className="text-xs text-blue-600 hover:underline"
                            title={r.suggestions[0]!.memo}
                          >
                            Match (1 found)
                          </button>
                        ) : (
                          <span className="text-xs text-fg-muted">
                            No matches
                          </span>
                        )}
                        <button
                          onClick={() => ignoreRow(r)}
                          className="text-xs text-fg-muted hover:text-error"
                        >
                          Ignore
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>

      <BankFeedImportModal
        open={importOpen}
        bankAccountId={bankAccountId}
        onClose={() => setImportOpen(false)}
        onImported={async () => {
          setImportOpen(false);
          await load();
        }}
      />
    </Card>
  );
}

export default BankFeedTab;
