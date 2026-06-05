"use client";

// Companies + cash manager (the "Manage" tab). Lists the user's companies with
// their cash balance and held-by usage count, and wires the add / edit / set-
// cash / delete flows. Cash is summed (converted to the display currency) into
// a footer total that matches the dashboard headline's cash figure (PDR §9).
import { useState } from "react";
import {
  Building2,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  Wallet,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dropdown, DropdownItem } from "@/components/ui/dropdown";
import { TableSkeleton } from "@/components/skeletons";
import { useSettingsStore } from "@/store/useSettingsStore";
import { formatCurrency } from "@/lib/utils/formatCurrency";
import {
  useCompanies,
  useCashValue,
  type ApiCompany,
} from "@/lib/hooks/useCompanies";
import { CompanyFormDialog } from "./CompanyFormDialog";
import { DeleteCompanyDialog } from "./DeleteCompanyDialog";

export function CompaniesCard() {
  const numberFormat = useSettingsStore((s) => s.numberFormat);
  const displayCurrency = useSettingsStore((s) => s.displayCurrency);
  const { data, isLoading, error, refetch } = useCompanies();
  const cashValue = useCashValue();

  const companies = data?.companies ?? [];

  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<ApiCompany | null>(null);
  const [deleting, setDeleting] = useState<ApiCompany | null>(null);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Building2 className="h-4 w-4 text-fg-muted" />
          <CardTitle>Companies</CardTitle>
          {companies.length > 0 && (
            <Badge variant="muted">{companies.length}</Badge>
          )}
        </div>
        <Button size="sm" onClick={() => setAddOpen(true)}>
          <Plus className="h-[13px] w-[13px]" />
          Add company
        </Button>
      </CardHeader>

      <CardContent className="p-0">
        {error ? (
          <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
            <p className="text-sm font-semibold text-fg">
              Couldn&apos;t load companies
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
            <TableSkeleton rows={4} columns={4} />
          </div>
        ) : companies.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-surface-highest">
              <Building2 className="h-5 w-5 text-fg-muted" />
            </div>
            <p className="text-sm font-semibold text-fg">No companies yet</p>
            <p className="mt-1 max-w-sm text-xs text-fg-muted">
              Create a company (e.g. “Ofra Iris”, “Ramco”) to assign your
              holdings to it and track its cash balance.
            </p>
            <Button className="mt-5" onClick={() => setAddOpen(true)}>
              <Plus className="h-4 w-4" />
              Add your first company
            </Button>
          </div>
        ) : (
          <>
            <Table>
              <THead>
                <TR className="hover:bg-transparent">
                  <TH>Company</TH>
                  <TH className="text-right">Cash balance</TH>
                  <TH className="text-right">Holdings</TH>
                  <TH className="w-10" aria-label="Actions" />
                </TR>
              </THead>
              <TBody>
                {companies.map((c) => (
                  <TR key={c.id} className="group">
                    <TD className="font-medium text-fg">{c.name}</TD>
                    <TD className="text-right font-display">
                      {c.cashBalance > 0
                        ? formatCurrency(c.cashBalance, c.cashCurrency, {
                            format: numberFormat,
                          })
                        : "—"}
                    </TD>
                    <TD className="text-right text-fg-muted">
                      {c.positionCount}
                    </TD>
                    <TD className="text-right">
                      <Dropdown
                        align="end"
                        trigger={
                          <span
                            className="flex h-7 w-7 items-center justify-center rounded text-fg-muted transition-colors hover:bg-surface-highest hover:text-fg"
                            aria-label={`Actions for ${c.name}`}
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </span>
                        }
                      >
                        <DropdownItem onClick={() => setEditing(c)}>
                          <Pencil className="h-3.5 w-3.5" />
                          Edit / set cash
                        </DropdownItem>
                        <DropdownItem
                          onClick={() => setDeleting(c)}
                          className="hover:text-error"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Delete company
                        </DropdownItem>
                      </Dropdown>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>

            <div className="flex items-center justify-between gap-3 border-t border-border bg-surface/40 px-[14px] py-3">
              <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-fg-muted">
                <Wallet className="h-3.5 w-3.5" />
                Total cash
              </span>
              <span className="font-display text-sm font-bold text-fg">
                {formatCurrency(cashValue, displayCurrency, {
                  format: numberFormat,
                })}
              </span>
            </div>
          </>
        )}
      </CardContent>

      {/* Add / edit / delete dialogs (mounted once, driven by local state). */}
      <CompanyFormDialog
        open={addOpen}
        mode="create"
        onClose={() => setAddOpen(false)}
      />
      <CompanyFormDialog
        open={Boolean(editing)}
        mode="edit"
        company={editing}
        onClose={() => setEditing(null)}
      />
      <DeleteCompanyDialog
        company={deleting}
        onClose={() => setDeleting(null)}
      />
    </Card>
  );
}
