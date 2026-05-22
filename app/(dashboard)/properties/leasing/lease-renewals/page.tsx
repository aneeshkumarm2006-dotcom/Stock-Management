// /properties/leasing/lease-renewals — Renewal sub-tabs per BR-LL-12.
// Sub-tabs: Not started | Renewal offers (n) | Accepted offers (n).
// Implementation: queries DraftLeases that descend from a Lease via
// `Fixed w/rollover` and surfaces them by executionStatus.
"use client";

import * as React from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";

interface DraftSummary {
  id: string;
  draftId: number;
  propertyId: string;
  unitId: string;
  leaseType: string;
  startDate: string | null;
  endDate: string | null;
  executionStatus: string;
  esignatureStatus: string;
}

interface LeaseSummary {
  id: string;
  leaseNumber: number;
  endDate: string | null;
  status: string;
  daysRemaining: number | null;
  leaseType: string;
}

export default function LeaseRenewalsPage() {
  const [drafts, setDrafts] = React.useState<DraftSummary[]>([]);
  const [activeLeases, setActiveLeases] = React.useState<LeaseSummary[]>([]);

  React.useEffect(() => {
    Promise.all([
      fetch("/api/pm/draft-leases").then((r) => (r.ok ? r.json() : [])),
      fetch("/api/pm/leases?status=Active,Expired").then((r) =>
        r.ok ? r.json() : [],
      ),
    ]).then(([d, l]) => {
      setDrafts(d as DraftSummary[]);
      setActiveLeases(l as LeaseSummary[]);
    });
  }, []);

  const renewalDrafts = drafts.filter((d) => d.leaseType === "Fixed w/rollover");
  const offers = renewalDrafts.filter(
    (d) =>
      d.executionStatus === "Out for signature" ||
      d.executionStatus === "Ready to execute",
  );
  const accepted = renewalDrafts.filter(
    (d) => d.executionStatus === "Executed",
  );
  const notStarted = activeLeases.filter(
    (l) => l.daysRemaining != null && l.daysRemaining <= 90,
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Lease renewals</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="notStarted">
            <TabsList>
              <TabsTrigger value="notStarted">
                Not started <Badge variant="muted" className="ml-1">{notStarted.length}</Badge>
              </TabsTrigger>
              <TabsTrigger value="offers">
                Renewal offers <Badge variant="muted" className="ml-1">{offers.length}</Badge>
              </TabsTrigger>
              <TabsTrigger value="accepted">
                Accepted offers <Badge variant="muted" className="ml-1">{accepted.length}</Badge>
              </TabsTrigger>
            </TabsList>

            <TabsContent value="notStarted">
              <p className="text-xs text-fg-muted mb-2">
                Active or Expired leases with ≤ 90 days remaining ([G-B-8]).
              </p>
              {notStarted.length === 0 ? (
                <p className="text-sm text-fg-muted">No upcoming renewals.</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {notStarted.map((l) => (
                    <li key={l.id}>
                      <Link
                        href={`/properties/rentals/rent-roll/${l.id}`}
                        className="hover:underline"
                      >
                        Lease #{l.leaseNumber}
                      </Link>{" "}
                      <span className="text-fg-muted">
                        {l.daysRemaining}d remaining
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </TabsContent>

            <TabsContent value="offers">
              {offers.length === 0 ? (
                <p className="text-sm text-fg-muted">No outstanding offers.</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {offers.map((d) => (
                    <li key={d.id}>
                      <Link
                        href={`/properties/leasing/draft-leases/${d.id}`}
                        className="hover:underline"
                      >
                        Draft #{d.draftId}
                      </Link>{" "}
                      <Badge variant="muted">{d.executionStatus}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </TabsContent>

            <TabsContent value="accepted">
              {accepted.length === 0 ? (
                <p className="text-sm text-fg-muted">No accepted renewals.</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {accepted.map((d) => (
                    <li key={d.id}>
                      <Link
                        href={`/properties/leasing/draft-leases/${d.id}`}
                        className="hover:underline"
                      >
                        Draft #{d.draftId}
                      </Link>{" "}
                      <Badge variant="gain">Executed</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
