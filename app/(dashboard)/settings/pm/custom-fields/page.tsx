// /settings/pm/custom-fields — CRUD on org-scoped CustomFieldDefinition.
"use client";

import * as React from "react";
import { Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

interface CustomField {
  id: string;
  entityType: string;
  key: string;
  label: string;
  fieldType: "text" | "number" | "date" | "boolean" | "enum";
  enumOptions: string[] | null;
  required: boolean;
  order: number;
  active: boolean;
}

const ENTITY_TYPES = [
  "Property",
  "Unit",
  "Lease",
  "Tenant",
  "RentalOwner",
  "Vendor",
  "WorkOrder",
  "Applicant",
  "Listing",
  "Task",
  "Bill",
];

export default function CustomFieldsPage() {
  const { toast } = useToast();
  const [entityType, setEntityType] = React.useState("Property");
  const [rows, setRows] = React.useState<CustomField[]>([]);
  const [loading, setLoading] = React.useState(true);

  const load = React.useCallback(async () => {
    setLoading(true);
    const r = await fetch(
      `/api/pm/custom-fields?entityType=${encodeURIComponent(entityType)}`,
    );
    if (r.ok) {
      setRows((await r.json()) as CustomField[]);
    }
    setLoading(false);
  }, [entityType]);

  React.useEffect(() => {
    load();
  }, [load]);

  async function createField(form: FormData) {
    const enumOptionsRaw = String(form.get("enumOptions") ?? "").trim();
    const fieldType = String(form.get("fieldType") ?? "text") as CustomField["fieldType"];
    const payload = {
      entityType,
      key: String(form.get("key") ?? ""),
      label: String(form.get("label") ?? ""),
      fieldType,
      required: form.get("required") === "on",
      ...(fieldType === "enum" && enumOptionsRaw
        ? { enumOptions: enumOptionsRaw.split(",").map((s) => s.trim()).filter(Boolean) }
        : {}),
    };
    const res = await fetch("/api/pm/custom-fields", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      toast({ title: "Failed", description: err.error, variant: "error" });
      return;
    }
    toast({ title: "Custom field added", variant: "success" });
    await load();
  }

  async function remove(id: string) {
    const res = await fetch(`/api/pm/custom-fields/${id}`, { method: "DELETE" });
    if (!res.ok) {
      toast({ title: "Delete failed", variant: "error" });
      return;
    }
    toast({ title: "Archived", variant: "success" });
    await load();
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Custom field definitions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="entity-type">Entity</Label>
            <select
              id="entity-type"
              value={entityType}
              onChange={(e) => setEntityType(e.target.value)}
              className="h-10 w-full rounded border border-border bg-surface-highest px-3 text-sm text-fg md:w-72"
            >
              {ENTITY_TYPES.map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </select>
          </div>

          <form
            action={createField}
            className="grid gap-3 rounded border border-border bg-surface p-4 md:grid-cols-2"
          >
            <div className="space-y-1">
              <Label htmlFor="cf-key">Key</Label>
              <Input id="cf-key" name="key" placeholder="pet_weight_limit" required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="cf-label">Label</Label>
              <Input id="cf-label" name="label" placeholder="Pet weight limit (lbs)" required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="cf-type">Type</Label>
              <select
                id="cf-type"
                name="fieldType"
                className="h-10 w-full rounded border border-border bg-surface-highest px-3 text-sm text-fg"
                defaultValue="text"
              >
                <option value="text">Text</option>
                <option value="number">Number</option>
                <option value="date">Date</option>
                <option value="boolean">Boolean</option>
                <option value="enum">Enum</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="cf-enum">Enum options (comma-sep, enum only)</Label>
              <Input id="cf-enum" name="enumOptions" placeholder="Small, Medium, Large" />
            </div>
            <label className="flex items-center gap-2 text-sm text-fg-muted md:col-span-2">
              <input type="checkbox" name="required" /> Required
            </label>
            <div className="md:col-span-2">
              <Button type="submit">Add field</Button>
            </div>
          </form>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border text-left text-xs uppercase tracking-widest text-fg-muted">
                <tr>
                  <th className="py-2">Key</th>
                  <th>Label</th>
                  <th>Type</th>
                  <th>Required</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={5} className="py-4 text-fg-muted">
                      Loading…
                    </td>
                  </tr>
                )}
                {!loading && rows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-4 text-fg-muted">
                      No custom fields yet.
                    </td>
                  </tr>
                )}
                {rows.map((f) => (
                  <tr key={f.id} className="border-b border-border/40">
                    <td className="py-2 font-mono text-xs text-fg">{f.key}</td>
                    <td>{f.label}</td>
                    <td className="text-fg-muted">{f.fieldType}</td>
                    <td className="text-fg-muted">{f.required ? "Yes" : "No"}</td>
                    <td className="text-right">
                      <button
                        type="button"
                        onClick={() => remove(f.id)}
                        className="rounded p-1 text-fg-muted hover:bg-surface-high hover:text-error"
                        aria-label="Archive field"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
