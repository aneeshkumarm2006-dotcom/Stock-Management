// /settings/pm — Organization settings landing.
"use client";

import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

type Mode = "cash" | "accrual";

interface OrgPayload {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  fiscalYearStart: string;
  accountingMode: Mode;
  defaultCurrency: "USD" | "CAD";
  estimatedIncomeTaxRatePct: number;
  senderMailbox: {
    defaultFrom: string | null;
    perPropertyOverrides: Record<string, string>;
  };
  trialEndsAt: string;
  subscriptionStatus: string;
  active: boolean;
}

const TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Anchorage",
  "America/Toronto",
  "America/Vancouver",
  "Europe/London",
  "UTC",
];

export default function OrgSettingsPage() {
  const { toast } = useToast();
  const [data, setData] = React.useState<OrgPayload | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    fetch("/api/pm/organization")
      .then(async (r) => {
        if (!r.ok) throw new Error(`Failed (${r.status})`);
        return r.json() as Promise<OrgPayload>;
      })
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loadError) {
    return (
      <Card>
        <CardContent>
          <p className="text-sm text-error">Could not load organization: {loadError}</p>
        </CardContent>
      </Card>
    );
  }
  if (!data) {
    return (
      <Card>
        <CardContent>
          <p className="text-sm text-fg-muted">Loading…</p>
        </CardContent>
      </Card>
    );
  }

  async function save(patch: Record<string, unknown>) {
    setSaving(true);
    try {
      const res = await fetch("/api/pm/organization", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        toast({
          title: "Save failed",
          description: err.error ?? `HTTP ${res.status}`,
          variant: "error",
        });
        return;
      }
      const next = (await res.json()) as OrgPayload;
      setData(next);
      toast({ title: "Saved", variant: "success" });
    } finally {
      setSaving(false);
    }
  }

  const trial = data.trialEndsAt
    ? Math.max(
        0,
        Math.ceil(
          (new Date(data.trialEndsAt).getTime() - Date.now()) /
            (24 * 60 * 60 * 1000),
        ),
      )
    : 0;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Organization</CardTitle>
          <span className="text-xs text-fg-muted">{data.slug}</span>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="org-name">Workspace name</Label>
            <Input
              id="org-name"
              defaultValue={data.name}
              onBlur={(e) =>
                e.target.value !== data.name && save({ name: e.target.value })
              }
            />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="org-tz">Timezone</Label>
              <select
                id="org-tz"
                value={data.timezone}
                onChange={(e) => save({ timezone: e.target.value })}
                className="h-10 w-full rounded border border-border bg-surface-highest px-3 text-sm text-fg"
              >
                {TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="org-fy">Fiscal year start (MM-DD)</Label>
              <Input
                id="org-fy"
                defaultValue={data.fiscalYearStart}
                placeholder="01-01"
                onBlur={(e) =>
                  e.target.value !== data.fiscalYearStart &&
                  save({ fiscalYearStart: e.target.value })
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="org-currency">Currency</Label>
              <select
                id="org-currency"
                value={data.defaultCurrency}
                onChange={(e) => save({ defaultCurrency: e.target.value })}
                className="h-10 w-full rounded border border-border bg-surface-highest px-3 text-sm text-fg"
              >
                <option value="USD">USD — US dollar</option>
                <option value="CAD">CAD — Canadian dollar</option>
              </select>
              <p className="text-xs text-fg-muted">
                Reporting currency for every money amount (Change §0A).
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Accounting basis</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-3">
            {(["cash", "accrual"] as Mode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => save({ accountingMode: m })}
                disabled={saving}
                className={
                  data.accountingMode === m
                    ? "rounded border-2 border-primary bg-primary/10 px-4 py-2 text-sm font-semibold text-primary"
                    : "rounded border border-border bg-surface-highest px-4 py-2 text-sm text-fg-muted hover:text-fg"
                }
              >
                {m === "cash" ? "Cash" : "Accrual"}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-fg-muted">
            Recomputes financial views — never modifies journal rows (BR-AC-2).
          </p>

          <div className="mt-4 max-w-xs space-y-2 border-t border-border pt-4">
            <Label htmlFor="org-tax-rate">Estimated income-tax rate (%)</Label>
            <Input
              id="org-tax-rate"
              type="number"
              min={0}
              max={100}
              step="0.01"
              defaultValue={data.estimatedIncomeTaxRatePct}
              onBlur={(e) => {
                const next = Number(e.target.value);
                if (
                  Number.isFinite(next) &&
                  next >= 0 &&
                  next <= 100 &&
                  next !== data.estimatedIncomeTaxRatePct
                ) {
                  save({ estimatedIncomeTaxRatePct: next });
                }
              }}
            />
            <p className="text-xs text-fg-muted">
              Drives the estimated income-taxes line on company financials
              (Change §0C). Display only — never posts a GL liability.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Sender mailbox</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Label htmlFor="sender-default">Default From address</Label>
          <Input
            id="sender-default"
            type="email"
            placeholder="ops@yourcompany.com"
            defaultValue={data.senderMailbox.defaultFrom ?? ""}
            onBlur={(e) =>
              e.target.value !== (data.senderMailbox.defaultFrom ?? "") &&
              save({
                senderMailbox: {
                  defaultFrom: e.target.value || undefined,
                  perPropertyOverrides: data.senderMailbox.perPropertyOverrides,
                },
              })
            }
          />
          <p className="text-xs text-fg-muted">
            Per-property overrides land in Phase 1+ (BR-CC-5).
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Subscription</CardTitle>
          <span className="text-xs uppercase tracking-widest text-fg-muted">
            {data.subscriptionStatus}
          </span>
        </CardHeader>
        <CardContent className="flex items-center justify-between">
          <p className="text-sm text-fg">
            Trial ends in <span className="font-bold">{trial}</span> day
            {trial === 1 ? "" : "s"}.
          </p>
          <Button variant="primary" disabled>
            Buy now
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
