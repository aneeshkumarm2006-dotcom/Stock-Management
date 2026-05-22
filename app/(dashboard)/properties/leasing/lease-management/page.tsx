// /properties/leasing/lease-management — Move outs | Move ins | Vacancies.
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

interface LeaseSummary {
  id: string;
  leaseNumber: number;
  propertyId: string;
  unitId: string;
  endDate: string | null;
  daysRemaining: number | null;
  status: string;
}
interface DraftSummary {
  id: string;
  draftId: number;
  executionStatus: string;
  unitId: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export default function LeaseManagementPage() {
  const [leases, setLeases] = React.useState<LeaseSummary[]>([]);
  const [drafts, setDrafts] = React.useState<DraftSummary[]>([]);

  React.useEffect(() => {
    Promise.all([
      fetch("/api/pm/leases").then((r) => (r.ok ? r.json() : [])),
      fetch("/api/pm/draft-leases?executionStatus=Ready to execute").then((r) =>
        r.ok ? r.json() : [],
      ),
    ]).then(([l, d]) => {
      setLeases(l as LeaseSummary[]);
      setDrafts(d as DraftSummary[]);
    });
  }, []);

  const moveOuts = leases.filter(
    (l) => l.endDate && new Date(l.endDate).getTime() <= Date.now() + 30 * DAY_MS,
  );
  const moveIns = drafts;
  const occupiedUnitIds = new Set(leases.map((l) => l.unitId));

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Leasing</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="moveOuts">
            <TabsList>
              <TabsTrigger value="moveOuts">
                Move outs <Badge variant="muted" className="ml-1">{moveOuts.length}</Badge>
              </TabsTrigger>
              <TabsTrigger value="moveIns">
                Move ins <Badge variant="muted" className="ml-1">{moveIns.length}</Badge>
              </TabsTrigger>
              <TabsTrigger value="vacancies">Vacancies</TabsTrigger>
            </TabsList>

            <TabsContent value="moveOuts">
              <p className="text-xs text-fg-muted mb-2">
                Active leases with endDate within the next 30 days.
              </p>
              {moveOuts.length === 0 ? (
                <p className="text-sm text-fg-muted">No upcoming move-outs.</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {moveOuts.map((l) => (
                    <li key={l.id}>
                      <Link
                        href={`/properties/rentals/rent-roll/${l.id}`}
                        className="hover:underline"
                      >
                        Lease #{l.leaseNumber}
                      </Link>{" "}
                      <span className="text-fg-muted">
                        ends{" "}
                        {l.endDate
                          ? new Date(l.endDate).toLocaleDateString()
                          : "—"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </TabsContent>

            <TabsContent value="moveIns">
              <p className="text-xs text-fg-muted mb-2">
                Draft leases ready to execute.
              </p>
              {moveIns.length === 0 ? (
                <p className="text-sm text-fg-muted">No upcoming move-ins.</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {moveIns.map((d) => (
                    <li key={d.id}>
                      <Link
                        href={`/properties/leasing/draft-leases/${d.id}`}
                        className="hover:underline"
                      >
                        Draft #{d.draftId}
                      </Link>{" "}
                      <Badge variant="gain">Ready to execute</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </TabsContent>

            <TabsContent value="vacancies">
              <p className="text-xs text-fg-muted mb-2">
                Units with no Active or Future lease. (Occupied unit count:{" "}
                {occupiedUnitIds.size})
              </p>
              <p className="text-sm text-fg-muted">
                Cross-property vacancy aggregation surfaces on the Property
                detail vacancy widget.{" "}
                <Link href="/properties/rentals/properties" className="underline">
                  Browse properties
                </Link>
              </p>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
