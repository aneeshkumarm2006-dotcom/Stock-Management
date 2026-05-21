// /properties/accounting/banking/[id] — bank-account detail.
// Phase 1 ships the identity card + Register/Reconciliation tab strip; the
// inner content is Phase 2/9. Register relies on JournalLine (Phase 2);
// Reconciliation relies on the bank-feed wizard (Phase 9).
"use client";

import * as React from "react";
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
  active: boolean;
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
          </dl>
        </CardContent>
      </Card>

      <Tabs defaultValue="register">
        <TabsList>
          <TabsTrigger value="register">Register</TabsTrigger>
          <TabsTrigger value="reconciliation">Reconciliation</TabsTrigger>
        </TabsList>
        <TabsContent value="register">
          <ComingSoon
            title="Register"
            description="Line-by-line bank register lands in Phase 2 once the General Ledger ships."
          />
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
