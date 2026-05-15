"use client";

// Data management (PDR §5.7): CSV export, CSV import with an inline per-row
// error report (commit only valid rows), and "Clear all data" gated by a
// typed confirmation. Mutations are blocked while offline (PDR §11), matching
// the DeletePositionDialog pattern.
import { useRef, useState } from "react";
import {
  AlertTriangle,
  Download,
  Loader2,
  Trash2,
  Upload,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { useUiStore } from "@/store/useUiStore";
import {
  useClearAllData,
  useImportPositions,
  type ImportResult,
} from "@/lib/hooks/useSettings";

const CONFIRM_PHRASE = "DELETE";

export function DataManagement() {
  const isOffline = useUiStore((s) => s.isOffline);
  const { toast } = useToast();

  /* -------- Export -------- */
  const [exporting, setExporting] = useState(false);

  async function exportCsv() {
    setExporting(true);
    try {
      const res = await fetch("/api/export", {
        headers: { accept: "text/csv" },
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body.error ?? `Export failed (${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "positions.csv";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast({ title: "Export ready", variant: "success" });
    } catch (err) {
      toast({
        title: "Export failed",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "error",
      });
    } finally {
      setExporting(false);
    }
  }

  /* -------- Import -------- */
  const fileRef = useRef<HTMLInputElement>(null);
  const importMut = useImportPositions();
  const [report, setReport] = useState<ImportResult | null>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file
    if (!file) return;
    if (isOffline) {
      toast({
        title: "You're offline",
        description: "Reconnect to import positions.",
        variant: "error",
      });
      return;
    }
    setReport(null);
    try {
      const csv = await file.text();
      const result = await importMut.mutateAsync(csv);
      setReport(result);
      toast({
        title:
          result.committed > 0
            ? `Imported ${result.committed} position${result.committed === 1 ? "" : "s"}`
            : "Nothing imported",
        description:
          result.failed > 0
            ? `${result.failed} row${result.failed === 1 ? "" : "s"} skipped — see report below.`
            : undefined,
        variant: result.committed > 0 ? "success" : "error",
      });
    } catch (err) {
      toast({
        title: "Import failed",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "error",
      });
    }
  }

  /* -------- Clear all -------- */
  const clearMut = useClearAllData();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [phrase, setPhrase] = useState("");

  function openClear() {
    setPhrase("");
    setConfirmOpen(true);
  }

  async function confirmClear() {
    if (phrase !== CONFIRM_PHRASE) return;
    if (isOffline) {
      toast({
        title: "You're offline",
        description: "Reconnect to clear your data.",
        variant: "error",
      });
      return;
    }
    try {
      const { deleted } = await clearMut.mutateAsync();
      setConfirmOpen(false);
      setReport(null);
      toast({
        title: "All data cleared",
        description: `${deleted} position${deleted === 1 ? "" : "s"} permanently deleted.`,
        variant: "success",
      });
    } catch (err) {
      toast({
        title: "Couldn't clear data",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "error",
      });
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Data Management</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Export */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-fg">Export positions</p>
            <p className="mt-0.5 text-xs text-fg-muted">
              Download every holding as a CSV (round-trips back through import).
            </p>
          </div>
          <Button
            variant="secondary"
            onClick={exportCsv}
            disabled={exporting || isOffline}
          >
            {exporting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            Export CSV
          </Button>
        </div>

        <div className="h-px bg-border" />

        {/* Import */}
        <div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-fg">
                Import positions
              </p>
              <p className="mt-0.5 text-xs text-fg-muted">
                CSV header:{" "}
                <code className="rounded bg-surface-highest px-1 py-0.5 text-[11px] text-fg">
                  ticker,exchange,quantity,avgBuyPrice,currency,buyDate
                </code>
                . Each row is validated independently; only valid rows are
                committed.
              </p>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={onFile}
            />
            <Button
              variant="secondary"
              onClick={() => fileRef.current?.click()}
              disabled={importMut.isPending || isOffline}
            >
              {importMut.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              Choose CSV file
            </Button>
          </div>

          {report && (
            <div className="mt-4 rounded-md border border-border bg-surface-highest p-4">
              <p className="text-xs font-medium text-fg">
                {report.committed} committed · {report.failed} failed ·{" "}
                {report.total} total rows
              </p>
              {report.errors.length > 0 && (
                <ul className="mt-3 max-h-48 space-y-1 overflow-y-auto text-[11px] text-loss">
                  {report.errors.map((er) => (
                    <li key={er.row}>
                      <span className="font-semibold">Row {er.row}:</span>{" "}
                      {er.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        <div className="h-px bg-border" />

        {/* Clear all */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-loss">Clear all data</p>
            <p className="mt-0.5 text-xs text-fg-muted">
              Permanently delete every position in your portfolio. This cannot
              be undone.
            </p>
          </div>
          <Button
            variant="destructive"
            onClick={openClear}
            disabled={isOffline}
          >
            <Trash2 className="h-4 w-4" />
            Clear all data
          </Button>
        </div>
      </CardContent>

      <Dialog
        open={confirmOpen}
        onOpenChange={(o) => !o && setConfirmOpen(false)}
      >
        <DialogContent className="w-full max-w-md">
          <DialogHeader
            title="Clear all data?"
            description="Every position you hold will be permanently deleted. This cannot be undone."
            onClose={() => setConfirmOpen(false)}
          />
          <div className="flex items-start gap-2 rounded-md border border-error/40 bg-error/10 p-3 text-xs text-fg">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-error" />
            <p>
              Type{" "}
              <span className="font-bold text-loss">{CONFIRM_PHRASE}</span> to
              confirm.
            </p>
          </div>
          <Input
            className="mt-3"
            value={phrase}
            autoFocus
            placeholder={CONFIRM_PHRASE}
            onChange={(e) => setPhrase(e.target.value)}
            aria-label={`Type ${CONFIRM_PHRASE} to confirm`}
          />
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setConfirmOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={confirmClear}
              disabled={
                phrase !== CONFIRM_PHRASE || clearMut.isPending || isOffline
              }
            >
              {clearMut.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Clearing…
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4" />
                  Delete everything
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
