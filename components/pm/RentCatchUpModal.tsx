// Catch-up modal for LEASE RENT.
//
// The lease sibling of RecurringCatchUpModal. Recurring bills have had a
// catch-up for months — which is why Municipal Taxes shows from January while
// Base Rent, OPEX Recoveries and Tax Recoveries start in July. This is the
// surface that closes that gap.
//
// Preview is mandatory before posting, and the preview is the same enumeration
// the apply path runs (`planLeaseRentCatchUp`), so it cannot promise a month
// the run won't deliver. The statuses it surfaces are the point of the whole
// screen: the nightly poster silently swallows a lease whose rent schedule has
// no active Term, so the client's only symptom is a month that is quietly
// short. Here every period comes back with a reason.
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
import { CurrencyAmount } from "@/components/pm/CurrencyAmount";
import { formatDateOnly } from "@/lib/utils/dateInput";

type Status =
  | "will-post"
  | "already-posted"
  | "covered-by-move-in"
  | "no-active-term"
  | "term-missing-base-account"
  | "zero-amount"
  | "locked"
  | "handled-by-scheduler"
  | "outside-lease-term"
  | "failed";

interface PlannedPeriod {
  leaseId: string;
  leaseNumber: number;
  leaseStatus: string;
  tenantLabel: string;
  propertyName: string;
  chargeKey: string;
  chargeLabel: string;
  periodDate: string;
  status: Status;
  amountCents: number;
  breakdown: { baseCents: number; opexCents: number; taxCents: number };
  source: string;
  note?: string;
  journalEntryId?: string;
}

interface CatchUpPlan {
  from: string;
  through: string;
  periods: PlannedPeriod[];
  totals: {
    willPost: number;
    willPostCents: number;
    alreadyPosted: number;
    blocked: number;
    skipped: number;
  };
  truncated?: string;
}

/** Plain-English reason, so the table never shows a raw status slug. */
const STATUS_LABEL: Record<Status, string> = {
  "will-post": "Will post",
  "already-posted": "Already posted",
  "covered-by-move-in": "Covered by move-in entry",
  "no-active-term": "No active Term in the rent schedule",
  "term-missing-base-account": "Term has no base income account",
  "zero-amount": "Nothing due",
  locked: "Locked period",
  "handled-by-scheduler": "Left to the scheduler",
  "outside-lease-term": "Outside the lease term",
  failed: "Failed",
};

/** Red = money is missing and this run will not fix it. */
const BLOCKING: ReadonlySet<Status> = new Set<Status>([
  "no-active-term",
  "term-missing-base-account",
  "locked",
  "failed",
]);

function rowClass(status: Status): string {
  if (BLOCKING.has(status)) return "bg-error/10 text-error";
  if (status === "will-post") return "";
  return "text-fg-muted";
}

export function RentCatchUpModal({
  open,
  onClose,
  onPosted,
}: {
  open: boolean;
  onClose: () => void;
  onPosted: () => Promise<void> | void;
}) {
  const { toast } = useToast();
  const [from, setFrom] = React.useState(defaultFrom);
  const [through, setThrough] = React.useState(defaultThrough);
  const [includeExpired, setIncludeExpired] = React.useState(false);
  const [plan, setPlan] = React.useState<CatchUpPlan | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [onlyProblems, setOnlyProblems] = React.useState(false);

  // A preview describes ONE set of inputs. Changing any of them invalidates it,
  // or the user could preview January and post a year.
  const inputKey = `${from}|${through}|${includeExpired}`;
  const [previewKey, setPreviewKey] = React.useState("");
  const planIsCurrent = plan !== null && previewKey === inputKey;

  async function call(dryRun: boolean) {
    return fetch("/api/pm/leases/catch-up-rent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from, through, includeExpired, dryRun }),
    });
  }

  async function preview() {
    setBusy(true);
    const res = await call(true);
    setBusy(false);
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      toast({
        title: "Preview failed",
        description: err.error,
        variant: "error",
      });
      return;
    }
    setPlan((await res.json()) as CatchUpPlan);
    setPreviewKey(inputKey);
  }

  async function post() {
    if (!plan || !planIsCurrent) return;
    if (plan.totals.willPost === 0) {
      toast({ title: "Nothing to post", variant: "error" });
      return;
    }
    const total = (plan.totals.willPostCents / 100).toFixed(2);
    const blocked = plan.totals.blocked;
    if (
      !confirm(
        `Post ${plan.totals.willPost} rent charge(s) totalling ${total} for ` +
          `${formatDateOnly(plan.from)} – ${formatDateOnly(plan.through)}?` +
          (blocked > 0
            ? `\n\n${blocked} period(s) are blocked and will NOT be posted — ` +
              `they need a data fix first.`
            : ""),
      )
    ) {
      return;
    }
    setBusy(true);
    const res = await call(false);
    setBusy(false);
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      toast({ title: "Post failed", description: err.error, variant: "error" });
      return;
    }
    const data = (await res.json()) as CatchUpPlan;
    setPlan(data);
    toast({
      title: `Posted ${data.totals.willPost} rent charge(s)`,
      description:
        data.totals.blocked > 0
          ? `${data.totals.blocked} still blocked — see the table.`
          : undefined,
      variant: "success",
    });
    await onPosted();
  }

  const visible = React.useMemo(() => {
    if (!plan) return [];
    return onlyProblems
      ? plan.periods.filter(
          (p) => BLOCKING.has(p.status) || p.status === "will-post",
        )
      : plan.periods;
  }, [plan, onlyProblems]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-5xl">
        <DialogHeader title="Catch up rent" onClose={onClose} />

        <div className="space-y-4">
          <p className="text-sm text-fg-muted">
            Posts rent for months that are already behind. Periods from the
            lease&apos;s next due date onward are left to the nightly poster and
            the &ldquo;Post recurring due now&rdquo; button.
          </p>

          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-1">
              <Label>From</Label>
              <Input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="h-9"
              />
            </div>
            <div className="space-y-1">
              <Label>Through</Label>
              <Input
                type="date"
                value={through}
                onChange={(e) => setThrough(e.target.value)}
                className="h-9"
              />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-sm text-fg">
                <input
                  type="checkbox"
                  checked={includeExpired}
                  onChange={(e) => setIncludeExpired(e.target.checked)}
                />
                Include ended leases
              </label>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={preview}
              disabled={busy}
            >
              {busy ? "Working…" : "Preview"}
            </Button>
            <Button
              size="sm"
              onClick={post}
              disabled={busy || !planIsCurrent || plan?.totals.willPost === 0}
            >
              Post
            </Button>
            {plan && !planIsCurrent && (
              <span className="text-xs text-warning">
                Dates changed — preview again before posting.
              </span>
            )}
          </div>

          {plan && (
            <>
              <div className="flex flex-wrap items-center gap-4 rounded border border-border bg-surface px-3 py-2 text-sm">
                <span>
                  <strong>{plan.totals.willPost}</strong> to post (
                  <CurrencyAmount
                    cents={plan.totals.willPostCents}
                    convert={false}
                  />
                  )
                </span>
                <span className="text-fg-muted">
                  {plan.totals.alreadyPosted} already posted
                </span>
                <span className="text-fg-muted">
                  {plan.totals.skipped} not applicable
                </span>
                {plan.totals.blocked > 0 && (
                  <span className="font-medium text-error">
                    {plan.totals.blocked} blocked
                  </span>
                )}
                <label className="ml-auto flex items-center gap-2 text-xs text-fg-muted">
                  <input
                    type="checkbox"
                    checked={onlyProblems}
                    onChange={(e) => setOnlyProblems(e.target.checked)}
                  />
                  Only show actionable rows
                </label>
              </div>

              {plan.truncated && (
                <p className="rounded border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-fg">
                  {plan.truncated}
                </p>
              )}

              <div className="max-h-96 overflow-auto rounded border border-border">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-surface text-left uppercase tracking-widest text-fg-muted">
                    <tr>
                      <th className="px-2 py-2">Period</th>
                      <th className="px-2 py-2">Lease</th>
                      <th className="px-2 py-2">Property</th>
                      <th className="px-2 py-2">Charge</th>
                      <th className="px-2 py-2 text-right">Amount</th>
                      <th className="px-2 py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((p) => (
                      <tr
                        key={`${p.leaseId}|${p.chargeKey}|${p.periodDate}`}
                        className={
                          "border-t border-border/40 " + rowClass(p.status)
                        }
                      >
                        <td className="px-2 py-1 tabular-nums">
                          {formatDateOnly(p.periodDate)}
                        </td>
                        <td className="px-2 py-1">
                          #{p.leaseNumber}
                          {p.tenantLabel ? ` — ${p.tenantLabel}` : ""}
                        </td>
                        <td className="px-2 py-1">{p.propertyName}</td>
                        <td className="px-2 py-1">{p.chargeLabel}</td>
                        <td className="px-2 py-1 text-right tabular-nums">
                          {p.amountCents > 0 ? (
                            <CurrencyAmount
                              cents={p.amountCents}
                              convert={false}
                            />
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-2 py-1">
                          {STATUS_LABEL[p.status]}
                          {p.note ? (
                            <span className="block text-[10px] opacity-80">
                              {p.note}
                            </span>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                    {visible.length === 0 && (
                      <tr>
                        <td
                          colSpan={6}
                          className="px-2 py-6 text-center text-fg-muted"
                        >
                          Nothing in this window.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** First of the current year — the "we are missing this year" default. */
function defaultFrom(): string {
  const now = new Date();
  return `${now.getFullYear()}-01-01`;
}

/** Last day of the previous month — the normal "close out what's behind"
 *  bound, matching RecurringCatchUpModal. Built from UTC parts so it names the
 *  same calendar day for every viewer. */
function defaultThrough(): string {
  const now = new Date();
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
  return end.toISOString().slice(0, 10);
}
