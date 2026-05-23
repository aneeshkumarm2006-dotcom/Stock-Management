// /properties/settings/approval-rules — Phase 9 multi-approver EFT
// rule manager (BR-AC-19, DECISIONS.md [G-S-31]). One row per
// ApprovalRule with inline edit + create modal. Approver picker reads
// the org members API.
"use client";

import * as React from "react";
import { Plus, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import {
  APPROVAL_RULE_SCOPE_TYPES,
  APPROVAL_RULE_SEMANTICS,
  type ApprovalRuleScopeType,
  type ApprovalRuleSemantics,
} from "@/types/pm";

interface Rule {
  id: string;
  scopeType: ApprovalRuleScopeType;
  scopeId: string | null;
  thresholdCents: number;
  semantics: ApprovalRuleSemantics;
  approverUserIds: string[];
  active: boolean;
}

interface Member {
  id: string;
  name: string;
  email: string;
}

interface PropertyOption {
  id: string;
  propertyName: string;
}

export default function ApprovalRulesPage() {
  const { toast } = useToast();
  const [rules, setRules] = React.useState<Rule[]>([]);
  const [members, setMembers] = React.useState<Member[]>([]);
  const [properties, setProperties] = React.useState<PropertyOption[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [modalOpen, setModalOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Rule | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    const r = await fetch("/api/pm/approval-rules");
    if (r.ok) setRules((await r.json()) as Rule[]);
    setLoading(false);
  }, []);

  React.useEffect(() => {
    load();
    fetch("/api/pm/org-members").then(async (r) => {
      if (r.ok) setMembers((await r.json()) as Member[]);
    });
    fetch("/api/pm/properties").then(async (r) => {
      if (r.ok) setProperties((await r.json()) as PropertyOption[]);
    });
  }, [load]);

  const memberById = React.useMemo(
    () => Object.fromEntries(members.map((m) => [m.id, m] as const)),
    [members],
  );
  const propertyNameById = React.useMemo(
    () => Object.fromEntries(properties.map((p) => [p.id, p.propertyName] as const)),
    [properties],
  );

  async function archive(rule: Rule) {
    if (!confirm("Deactivate this rule? New EFTs will fall back to the next rule or single-approver flow.")) {
      return;
    }
    const r = await fetch(`/api/pm/approval-rules/${rule.id}`, {
      method: "DELETE",
    });
    if (!r.ok) {
      toast({ title: "Deactivate failed", variant: "error" });
      return;
    }
    toast({ title: "Rule deactivated", variant: "success" });
    await load();
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>EFT approval rules</CardTitle>
          <Button
            size="sm"
            onClick={() => {
              setEditing(null);
              setModalOpen(true);
            }}
          >
            <Plus className="h-3.5 w-3.5" /> New rule
          </Button>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-fg-muted">Loading…</p>
          ) : rules.length === 0 ? (
            <p className="text-sm text-fg-muted">
              No approval rules configured. EFTs use the legacy single-approver
              flow until a rule is created.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b border-border text-left text-xs uppercase tracking-widest text-fg-muted">
                <tr>
                  <th className="py-2">Scope</th>
                  <th className="text-right">Threshold</th>
                  <th>Semantics</th>
                  <th>Approvers</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rules.map((r) => (
                  <tr key={r.id} className="border-b border-border/40">
                    <td className="py-2">
                      {r.scopeType}
                      {r.scopeId &&
                        ` · ${propertyNameById[r.scopeId] ?? r.scopeId.slice(-6)}`}
                    </td>
                    <td className="text-right tabular-nums">
                      <CurrencyAmount cents={r.thresholdCents} />
                    </td>
                    <td>{r.semantics}</td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        {r.approverUserIds.map((uid) => (
                          <span
                            key={uid}
                            className="rounded bg-bg-elevated px-1.5 py-0.5 text-xs"
                          >
                            {memberById[uid]?.name ?? uid.slice(-6)}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td>
                      <span
                        className={
                          "rounded px-1.5 py-0.5 text-[10px] font-bold uppercase " +
                          (r.active
                            ? "bg-success/10 text-success"
                            : "bg-surface-high text-fg-muted")
                        }
                      >
                        {r.active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="text-right">
                      <div className="flex justify-end gap-1.5">
                        <button
                          onClick={() => {
                            setEditing(r);
                            setModalOpen(true);
                          }}
                          className="text-xs text-blue-600 hover:underline"
                        >
                          Edit
                        </button>
                        {r.active && (
                          <button
                            onClick={() => archive(r)}
                            className="text-xs text-fg-muted hover:text-error"
                            aria-label="Deactivate rule"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <ApprovalRuleModal
        open={modalOpen}
        existing={editing}
        members={members}
        properties={properties}
        onClose={() => {
          setModalOpen(false);
          setEditing(null);
        }}
        onSaved={async () => {
          setModalOpen(false);
          setEditing(null);
          await load();
        }}
      />
    </div>
  );
}

interface ApprovalRuleModalProps {
  open: boolean;
  existing: Rule | null;
  members: Member[];
  properties: PropertyOption[];
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}

function ApprovalRuleModal({
  open,
  existing,
  members,
  properties,
  onClose,
  onSaved,
}: ApprovalRuleModalProps) {
  const { toast } = useToast();
  const [scopeType, setScopeType] =
    React.useState<ApprovalRuleScopeType>("Company");
  const [scopeId, setScopeId] = React.useState("");
  const [threshold, setThreshold] = React.useState("0");
  const [semantics, setSemantics] =
    React.useState<ApprovalRuleSemantics>("all-of");
  const [approverUserIds, setApproverUserIds] = React.useState<string[]>([]);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    if (existing) {
      setScopeType(existing.scopeType);
      setScopeId(existing.scopeId ?? "");
      setThreshold(String((existing.thresholdCents / 100).toFixed(2)));
      setSemantics(existing.semantics);
      setApproverUserIds(existing.approverUserIds);
    } else {
      setScopeType("Company");
      setScopeId("");
      setThreshold("0");
      setSemantics("all-of");
      setApproverUserIds([]);
    }
  }, [open, existing]);

  function toggleApprover(userId: string) {
    setApproverUserIds((prev) =>
      prev.includes(userId)
        ? prev.filter((u) => u !== userId)
        : [...prev, userId],
    );
  }

  function moveApprover(userId: string, direction: -1 | 1) {
    setApproverUserIds((prev) => {
      const idx = prev.indexOf(userId);
      if (idx < 0) return prev;
      const next = [...prev];
      const swapIdx = idx + direction;
      if (swapIdx < 0 || swapIdx >= next.length) return prev;
      [next[idx], next[swapIdx]] = [next[swapIdx]!, next[idx]!];
      return next;
    });
  }

  async function save() {
    if (scopeType === "Property" && !scopeId) {
      toast({ title: "Pick a property for property-scope rule", variant: "error" });
      return;
    }
    if (approverUserIds.length === 0) {
      toast({ title: "Pick at least one approver", variant: "error" });
      return;
    }
    setSaving(true);
    const url = existing
      ? `/api/pm/approval-rules/${existing.id}`
      : "/api/pm/approval-rules";
    const method = existing ? "PATCH" : "POST";
    const payload = existing
      ? {
          threshold: Number(threshold),
          semantics,
          approverUserIds,
        }
      : {
          scopeType,
          scopeId: scopeType === "Property" ? scopeId : undefined,
          threshold: Number(threshold),
          semantics,
          approverUserIds,
        };
    const r = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setSaving(false);
    if (!r.ok) {
      const body = (await r.json().catch(() => ({}))) as { error?: string };
      toast({
        title: body.error ?? "Save failed",
        variant: "error",
      });
      return;
    }
    toast({ title: existing ? "Rule updated" : "Rule created", variant: "success" });
    await onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader
          title={existing ? "Edit approval rule" : "New approval rule"}
          onClose={onClose}
        />
        <div className="space-y-3">
          {!existing && (
            <>
              <div>
                <Label>Scope</Label>
                <div className="flex gap-3 text-sm">
                  {APPROVAL_RULE_SCOPE_TYPES.map((s) => (
                    <label key={s} className="flex items-center gap-1.5">
                      <input
                        type="radio"
                        checked={scopeType === s}
                        onChange={() => setScopeType(s)}
                      />
                      {s}
                    </label>
                  ))}
                </div>
              </div>
              {scopeType === "Property" && (
                <div>
                  <Label htmlFor="rule-property">Property</Label>
                  <select
                    id="rule-property"
                    className="h-9 w-full rounded-md border border-border bg-bg-elevated px-2 text-sm"
                    value={scopeId}
                    onChange={(e) => setScopeId(e.target.value)}
                  >
                    <option value="">Select…</option>
                    {properties.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.propertyName}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </>
          )}

          <div>
            <Label htmlFor="rule-threshold">Threshold (USD)</Label>
            <Input
              id="rule-threshold"
              type="number"
              step="0.01"
              min="0"
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
            />
            <p className="mt-1 text-xs text-fg-muted">
              Rule applies when an EFT&apos;s amount is at least this much.
            </p>
          </div>

          <div>
            <Label>Semantics</Label>
            <div className="flex gap-3 text-sm">
              {APPROVAL_RULE_SEMANTICS.map((s) => (
                <label key={s} className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    checked={semantics === s}
                    onChange={() => setSemantics(s)}
                  />
                  {s === "all-of" ? "All approvers required" : "Any one approver"}
                </label>
              ))}
            </div>
          </div>

          <div>
            <Label>Approvers (order matters for all-of)</Label>
            <div className="space-y-1">
              {approverUserIds.length === 0 ? (
                <p className="text-xs text-fg-muted">
                  No approvers selected yet.
                </p>
              ) : (
                approverUserIds.map((uid, idx) => {
                  const m = members.find((x) => x.id === uid);
                  return (
                    <div
                      key={uid}
                      className="flex items-center gap-2 rounded border border-border px-2 py-1 text-sm"
                    >
                      <span className="text-xs text-fg-muted">{idx + 1}.</span>
                      <span className="flex-1">{m?.name ?? uid}</span>
                      <button
                        onClick={() => moveApprover(uid, -1)}
                        className="text-xs text-fg-muted hover:text-fg"
                        aria-label="Move up"
                      >
                        ↑
                      </button>
                      <button
                        onClick={() => moveApprover(uid, 1)}
                        className="text-xs text-fg-muted hover:text-fg"
                        aria-label="Move down"
                      >
                        ↓
                      </button>
                      <button
                        onClick={() => toggleApprover(uid)}
                        className="text-xs text-error hover:underline"
                      >
                        Remove
                      </button>
                    </div>
                  );
                })
              )}
            </div>
            <details className="mt-2 text-xs">
              <summary>Add approver</summary>
              <div className="mt-1 space-y-1">
                {members
                  .filter((m) => !approverUserIds.includes(m.id))
                  .map((m) => (
                    <button
                      key={m.id}
                      onClick={() => toggleApprover(m.id)}
                      className="block w-full rounded px-2 py-1 text-left text-sm hover:bg-bg-elevated"
                    >
                      {m.name} <span className="text-fg-muted">({m.email})</span>
                    </button>
                  ))}
              </div>
            </details>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving…" : existing ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
