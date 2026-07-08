"use client";

// Brokers manager (the "Manage" tab). Lists the user's brokers with their
// held-at usage count and wires the add / rename / delete flows. Brokers drive
// the holdings table's "Broker" column and the "split by broker" grouping.
// Mirrors CompaniesCard, minus cash.
import { useState } from "react";
import {
  Landmark,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dropdown, DropdownItem } from "@/components/ui/dropdown";
import { TableSkeleton } from "@/components/skeletons";
import { useBrokers, type ApiBroker } from "@/lib/hooks/useBrokers";
import { BrokerFormDialog } from "./BrokerFormDialog";
import { DeleteBrokerDialog } from "./DeleteBrokerDialog";

export function BrokersCard() {
  const { data, isLoading, error, refetch } = useBrokers();
  const brokers = data?.brokers ?? [];

  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<ApiBroker | null>(null);
  const [deleting, setDeleting] = useState<ApiBroker | null>(null);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Landmark className="h-4 w-4 text-fg-muted" />
          <CardTitle>Brokers</CardTitle>
          {brokers.length > 0 && <Badge variant="muted">{brokers.length}</Badge>}
        </div>
        <Button size="sm" onClick={() => setAddOpen(true)}>
          <Plus className="h-[13px] w-[13px]" />
          Add broker
        </Button>
      </CardHeader>

      <CardContent className="p-0">
        {error ? (
          <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
            <p className="text-sm font-semibold text-fg">
              Couldn&apos;t load brokers
            </p>
            <p className="mt-1 max-w-sm text-xs text-fg-muted">
              {error instanceof Error ? error.message : "Please try again."}
            </p>
            <Button
              variant="secondary"
              className="mt-5"
              onClick={() => void refetch()}
            >
              <RefreshCw className="h-4 w-4" />
              Retry
            </Button>
          </div>
        ) : isLoading ? (
          <div className="p-4">
            <TableSkeleton rows={4} columns={3} />
          </div>
        ) : brokers.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-surface-highest">
              <Landmark className="h-5 w-5 text-fg-muted" />
            </div>
            <p className="text-sm font-semibold text-fg">No brokers yet</p>
            <p className="mt-1 max-w-sm text-xs text-fg-muted">
              Add a broker (e.g. “Fidelity”, “Wealthsimple”) to assign your
              holdings to it and split your portfolio by broker.
            </p>
            <Button className="mt-5" onClick={() => setAddOpen(true)}>
              <Plus className="h-4 w-4" />
              Add your first broker
            </Button>
          </div>
        ) : (
          <Table>
            <THead>
              <TR className="hover:bg-transparent">
                <TH>Broker</TH>
                <TH className="text-right">Holdings</TH>
                <TH className="w-10" aria-label="Actions" />
              </TR>
            </THead>
            <TBody>
              {brokers.map((b) => (
                <TR key={b.id} className="group">
                  <TD className="font-medium text-fg">{b.name}</TD>
                  <TD className="text-right text-fg-muted">{b.positionCount}</TD>
                  <TD className="text-right">
                    <Dropdown
                      align="end"
                      trigger={
                        <span
                          className="flex h-7 w-7 items-center justify-center rounded text-fg-muted transition-colors hover:bg-surface-highest hover:text-fg"
                          aria-label={`Actions for ${b.name}`}
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </span>
                      }
                    >
                      <DropdownItem onClick={() => setEditing(b)}>
                        <Pencil className="h-3.5 w-3.5" />
                        Rename
                      </DropdownItem>
                      <DropdownItem
                        onClick={() => setDeleting(b)}
                        className="hover:text-error"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Delete broker
                      </DropdownItem>
                    </Dropdown>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </CardContent>

      {/* Add / rename / delete dialogs (mounted once, driven by local state). */}
      <BrokerFormDialog
        open={addOpen}
        mode="create"
        onClose={() => setAddOpen(false)}
      />
      <BrokerFormDialog
        open={Boolean(editing)}
        mode="edit"
        broker={editing}
        onClose={() => setEditing(null)}
      />
      <DeleteBrokerDialog broker={deleting} onClose={() => setDeleting(null)} />
    </Card>
  );
}
