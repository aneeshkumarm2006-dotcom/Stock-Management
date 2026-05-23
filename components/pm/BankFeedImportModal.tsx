// Bank feed import modal (DECISIONS.md [G-S-33]). Reads a CSV or OFX
// file client-side, previews the first 10 parsed rows, and posts the
// raw text + column mapping to /api/pm/bank-feed/import.
"use client";

import * as React from "react";
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

interface BankFeedImportModalProps {
  open: boolean;
  bankAccountId: string;
  onClose: () => void;
  onImported: () => Promise<void> | void;
}

type Source = "CSV" | "OFX";

export function BankFeedImportModal({
  open,
  bankAccountId,
  onClose,
  onImported,
}: BankFeedImportModalProps) {
  const { toast } = useToast();
  const [source, setSource] = React.useState<Source>("CSV");
  const [text, setText] = React.useState("");
  const [dateCol, setDateCol] = React.useState("Date");
  const [descCol, setDescCol] = React.useState("Description");
  const [amtCol, setAmtCol] = React.useState("Amount");
  const [refCol, setRefCol] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) {
      setText("");
      setSource("CSV");
    }
  }, [open]);

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const buf = await file.text();
    setText(buf);
    if (file.name.toLowerCase().endsWith(".ofx")) setSource("OFX");
    else setSource("CSV");
  }

  const previewCsvRows = React.useMemo(() => {
    if (source !== "CSV" || !text) return [];
    return text
      .split(/\r?\n/)
      .filter((l) => l.trim().length > 0)
      .slice(0, 11);
  }, [source, text]);

  async function importNow() {
    if (!text.trim()) {
      toast({ title: "Pick a file first", variant: "error" });
      return;
    }
    setSaving(true);
    const payload: Record<string, unknown> = {
      bankAccountId,
      source,
      text,
    };
    if (source === "CSV") {
      payload.mapping = {
        date: dateCol,
        description: descCol,
        amount: amtCol,
        externalRef: refCol || undefined,
      };
    }
    const r = await fetch("/api/pm/bank-feed/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setSaving(false);
    if (!r.ok) {
      const body = (await r.json().catch(() => ({}))) as { error?: string };
      toast({
        title: body.error ?? "Import failed",
        variant: "error",
      });
      return;
    }
    const result = (await r.json()) as {
      inserted: number;
      skipped: number;
      parsed: number;
    };
    toast({
      title: `Imported ${result.inserted} rows`,
      description:
        result.skipped > 0
          ? `${result.skipped} duplicates skipped`
          : undefined,
      variant: "success",
    });
    await onImported();
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader title="Import bank statement" onClose={onClose} />
        <div className="space-y-3">
          <div>
            <Label htmlFor="src-file">Statement file</Label>
            <Input
              id="src-file"
              type="file"
              accept=".csv,.ofx,.qfx,text/csv"
              onChange={onFileChange}
            />
            <p className="mt-1 text-xs text-fg-muted">
              CSV or OFX. OFX FITID is used as the dedupe key so re-imports
              are safe.
            </p>
          </div>

          <div>
            <Label>Source format</Label>
            <div className="flex gap-3 text-sm">
              {(["CSV", "OFX"] as const).map((s) => (
                <label key={s} className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    checked={source === s}
                    onChange={() => setSource(s)}
                  />
                  {s}
                </label>
              ))}
            </div>
          </div>

          {source === "CSV" && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="csv-date">Date column</Label>
                <Input
                  id="csv-date"
                  value={dateCol}
                  onChange={(e) => setDateCol(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="csv-desc">Description column</Label>
                <Input
                  id="csv-desc"
                  value={descCol}
                  onChange={(e) => setDescCol(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="csv-amt">Amount column</Label>
                <Input
                  id="csv-amt"
                  value={amtCol}
                  onChange={(e) => setAmtCol(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="csv-ref">External ref column (optional)</Label>
                <Input
                  id="csv-ref"
                  value={refCol}
                  onChange={(e) => setRefCol(e.target.value)}
                  placeholder="e.g. FITID"
                />
              </div>
            </div>
          )}

          {previewCsvRows.length > 0 && (
            <div className="rounded border border-border p-2 text-xs">
              <p className="font-bold uppercase tracking-widest text-fg-muted">
                Preview (first {previewCsvRows.length} rows)
              </p>
              <pre className="mt-1 overflow-x-auto whitespace-pre">
                {previewCsvRows.join("\n")}
              </pre>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={importNow} disabled={saving || !text.trim()}>
            {saving ? "Importing…" : "Import"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default BankFeedImportModal;
