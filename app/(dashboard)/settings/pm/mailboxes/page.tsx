// /settings/pm/mailboxes — sender mailbox configuration (BR-CC-5,
// DECISIONS.md [G-B-21]). Org default + optional per-property overrides.
// Edits restricted to Admins ([G-B-22]).
"use client";

import * as React from "react";
import { Trash2, Plus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

interface OverrideRow {
  propertyId: string;
  mailbox: string;
}

interface PropertyOption {
  id: string;
  name: string;
}

export default function MailboxesSettingsPage() {
  const { toast } = useToast();
  const [defaultFrom, setDefaultFrom] = React.useState("");
  const [overrides, setOverrides] = React.useState<OverrideRow[]>([]);
  const [properties, setProperties] = React.useState<PropertyOption[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [forbidden, setForbidden] = React.useState(false);

  React.useEffect(() => {
    Promise.all([
      fetch("/api/pm/org/sender-mailbox").then((r) =>
        r.ok ? r.json() : Promise.reject(r),
      ),
      fetch("/api/pm/properties").then((r) => (r.ok ? r.json() : [])),
    ])
      .then(([mb, props]) => {
        setDefaultFrom(mb.defaultFrom ?? "");
        setOverrides(mb.perPropertyOverrides ?? []);
        setProperties(
          (props as Array<{ id: string; name?: string; address?: { line1?: string } }>).map(
            (p) => ({ id: p.id, name: p.name ?? p.address?.line1 ?? p.id }),
          ),
        );
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, []);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/pm/org/sender-mailbox", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          defaultFrom: defaultFrom || null,
          perPropertyOverrides: overrides.filter(
            (o) => o.propertyId && o.mailbox,
          ),
        }),
      });
      if (res.status === 403) {
        setForbidden(true);
        toast({
          title: "Read-only",
          description: "Only Admins can edit the sender mailbox configuration.",
        });
        return;
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        toast({
          title: "Could not save",
          description: err.error ?? "Validation failed",
        });
        return;
      }
      toast({ title: "Mailbox configuration saved" });
    } finally {
      setSaving(false);
    }
  }

  function addOverride() {
    setOverrides((o) => [...o, { propertyId: "", mailbox: "" }]);
  }
  function updateOverride(idx: number, patch: Partial<OverrideRow>) {
    setOverrides((o) => {
      const copy = [...o];
      const existing = copy[idx];
      if (!existing) return o;
      copy[idx] = { ...existing, ...patch };
      return copy;
    });
  }
  function removeOverride(idx: number) {
    setOverrides((o) => o.filter((_, i) => i !== idx));
  }

  if (loading) {
    return <p className="p-6 text-sm text-fg-muted">Loading…</p>;
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-2xl font-bold text-fg">
          Sender mailboxes
        </h1>
        <p className="text-sm text-fg-muted">
          Set the From address used by Compose Email (BR-CC-5). Per-property
          overrides apply when an email is scoped to that property.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Org default</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-1">
            <Label htmlFor="default-from">Default From address</Label>
            <Input
              id="default-from"
              type="email"
              placeholder="leasing@company.com"
              value={defaultFrom}
              onChange={(e) => setDefaultFrom(e.target.value)}
            />
            <p className="text-xs text-fg-muted">
              Used when no per-property override applies and Compose doesn&apos;t
              specify a mailbox.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Per-property overrides</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {overrides.length === 0 && (
            <p className="text-sm text-fg-muted">No overrides yet.</p>
          )}
          {overrides.map((row, idx) => (
            <div
              key={idx}
              className="grid gap-2 md:grid-cols-[1fr_1fr_auto]"
            >
              <select
                className="w-full rounded border border-border bg-surface px-3 py-1.5 text-sm text-fg"
                value={row.propertyId}
                onChange={(e) =>
                  updateOverride(idx, { propertyId: e.target.value })
                }
              >
                <option value="">Choose property…</option>
                {properties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <Input
                type="email"
                placeholder="from@example.com"
                value={row.mailbox}
                onChange={(e) =>
                  updateOverride(idx, { mailbox: e.target.value })
                }
              />
              <button
                type="button"
                aria-label="Remove override"
                onClick={() => removeOverride(idx)}
                className="text-fg-muted transition-colors hover:text-error"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
          <Button size="sm" variant="secondary" onClick={addOverride}>
            <Plus className="mr-1 h-3.5 w-3.5" /> Add override
          </Button>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-3">
        {forbidden && (
          <p className="text-xs text-warning">
            Read-only — only Admins can save changes here.
          </p>
        )}
        <Button onClick={save} disabled={saving}>
          Save
        </Button>
      </div>
    </div>
  );
}
