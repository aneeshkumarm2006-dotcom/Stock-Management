// /properties/accounting/1099-tax-filings — Phase 9 1099 surface
// (DECISIONS.md [G-S-30]). Year selector + form-type tabs + vendor
// table with Download PDF / Send email actions. E-file integration is
// deferred; the E-file button shows a "Coming soon" toast.
"use client";

import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { CurrencyAmount } from "@/components/pm/CurrencyAmount";
import {
  TAX_1099_THRESHOLD_DOLLARS,
  type Tax1099FormType,
} from "@/types/pm";

interface Row {
  vendorId: string;
  displayName: string;
  printableName: string;
  printableAddress: {
    line1?: string;
    line2?: string;
    city?: string;
    state?: string;
    zip?: string;
  };
  taxIdentityType: string | null;
  taxpayerIdLast4: string | null;
  hasFullTin: boolean;
  totalPaidCents: number;
  formType: Tax1099FormType;
  meetsThreshold: boolean;
}

export default function Tax1099Page() {
  const { toast } = useToast();
  const thisYear = new Date().getFullYear();
  const [year, setYear] = React.useState<number>(thisYear - 1);
  const [rows, setRows] = React.useState<Row[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [hideBelowThreshold, setHideBelowThreshold] = React.useState(true);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/pm/1099?year=${year}`);
      if (r.ok) {
        const data = (await r.json()) as { rows: Row[] };
        setRows(data.rows);
      } else {
        setError(`Error ${r.status}`);
      }
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }, [year]);

  React.useEffect(() => {
    load();
  }, [load]);

  const visible = (formType: Tax1099FormType) =>
    rows.filter((r) =>
      hideBelowThreshold
        ? r.meetsThreshold && r.formType === formType
        : r.formType === formType,
    );

  function downloadPdf(row: Row, formType: Tax1099FormType) {
    const url = `/api/pm/1099/${row.vendorId}/pdf?year=${year}&formType=${formType}`;
    window.open(url, "_blank", "noopener");
  }

  async function sendEmail(row: Row, formType: Tax1099FormType) {
    const r = await fetch(
      `/api/pm/1099/${row.vendorId}/send?year=${year}&formType=${formType}`,
      { method: "POST" },
    );
    if (!r.ok) {
      const body = (await r.json().catch(() => ({}))) as { error?: string };
      toast({
        title: body.error ?? "Failed to send",
        variant: "error",
      });
      return;
    }
    toast({ title: "Email sent to vendor", variant: "success" });
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>1099 tax filings</CardTitle>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Label htmlFor="tax-year">Tax year</Label>
              <select
                id="tax-year"
                className="h-9 w-28 rounded-md border border-border bg-bg-elevated px-2 text-sm"
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
              >
                {[thisYear, thisYear - 1, thisYear - 2, thisYear - 3].map(
                  (y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ),
                )}
              </select>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={hideBelowThreshold}
                onChange={(e) => setHideBelowThreshold(e.target.checked)}
              />
              Hide below ${TAX_1099_THRESHOLD_DOLLARS} threshold
            </label>
            <Button
              size="sm"
              variant="outline"
              className="ml-auto"
              onClick={() =>
                toast({
                  title: "E-file coming soon",
                  description:
                    "Phase 9 ships PDF + email; e-file integration deferred per DECISIONS.md [G-S-30].",
                })
              }
            >
              E-file…
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {error && (
            <div className="mb-3 rounded border border-error/40 bg-error/10 px-3 py-2 text-sm text-error">
              {error} — could not load 1099 data.{" "}
              <button
                type="button"
                onClick={() => load()}
                className="font-bold underline"
              >
                Retry
              </button>
            </div>
          )}
          <Tabs defaultValue="NEC">
            <TabsList>
              <TabsTrigger value="NEC">1099-NEC</TabsTrigger>
              <TabsTrigger value="MISC">1099-MISC</TabsTrigger>
            </TabsList>
            <TabsContent value="NEC">
              <FormTable
                rows={visible("1099-NEC")}
                formType="1099-NEC"
                loading={loading}
                onDownload={downloadPdf}
                onSend={sendEmail}
              />
            </TabsContent>
            <TabsContent value="MISC">
              <FormTable
                rows={visible("1099-MISC")}
                formType="1099-MISC"
                loading={loading}
                onDownload={downloadPdf}
                onSend={sendEmail}
              />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}

interface FormTableProps {
  rows: Row[];
  formType: Tax1099FormType;
  loading: boolean;
  onDownload: (row: Row, formType: Tax1099FormType) => void;
  onSend: (row: Row, formType: Tax1099FormType) => Promise<void> | void;
}

function FormTable({
  rows,
  formType,
  loading,
  onDownload,
  onSend,
}: FormTableProps) {
  if (loading) return <p className="text-sm text-fg-muted">Loading…</p>;
  if (rows.length === 0) {
    return (
      <p className="text-sm text-fg-muted">
        No vendors meet the {formType} criteria for this year.
      </p>
    );
  }
  return (
    <table className="w-full text-sm">
      <thead className="border-b border-border text-left text-xs uppercase tracking-widest text-fg-muted">
        <tr>
          <th className="py-2">Vendor</th>
          <th>TIN</th>
          <th>Address</th>
          <th className="text-right">Total paid</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.vendorId} className="border-b border-border/40">
            <td className="py-1.5">
              <div className="font-medium">{r.printableName}</div>
              {r.printableName !== r.displayName && (
                <div className="text-xs text-fg-muted">
                  (vendor: {r.displayName})
                </div>
              )}
            </td>
            <td>
              {r.hasFullTin ? (
                <span className="rounded bg-success/10 px-1.5 py-0.5 text-[10px] font-bold uppercase text-success">
                  On file
                </span>
              ) : (
                <span className="rounded bg-warning/10 px-1.5 py-0.5 text-[10px] font-bold uppercase text-warning">
                  Missing
                </span>
              )}
              {r.taxpayerIdLast4 && (
                <span className="ml-1 text-xs text-fg-muted">
                  ····{r.taxpayerIdLast4}
                </span>
              )}
            </td>
            <td className="text-xs text-fg-muted">
              {[
                r.printableAddress?.city,
                r.printableAddress?.state,
                r.printableAddress?.zip,
              ]
                .filter(Boolean)
                .join(", ") || "—"}
            </td>
            <td className="text-right tabular-nums">
              <CurrencyAmount cents={r.totalPaidCents} />
            </td>
            <td className="text-right">
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => onDownload(r, formType)}
                  className="text-xs text-blue-600 hover:underline"
                >
                  Download PDF
                </button>
                <button
                  onClick={() => onSend(r, formType)}
                  className="text-xs text-blue-600 hover:underline"
                >
                  Send email
                </button>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
