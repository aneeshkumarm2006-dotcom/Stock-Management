"use client";

// Companies data layer — the per-user "held-by" entities plus their
// uninvested cash (PDR §6, §9). Mirrors the position mutations in
// usePortfolio.ts: TanStack Query owns the server read; every mutation
// invalidates BOTH ["companies"] and ["positions"], because the holdings
// table renders the company name and the dashboard total folds in cash.
//
// Cash contributes to the *headline* portfolio value only — useCashValue sums
// each company's balance converted to the display currency BEFORE adding
// (PDR §9), exactly like a holding's native currency. computePortfolio stays
// holdings-only so weights / allocations / P&L are unaffected.
import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchJson } from "@/lib/utils/apiFetch";
import { useSettingsStore } from "@/store/useSettingsStore";
import { convertCurrency } from "@/lib/utils/convertCurrency";

/* ------------------------------------------------------------------ */
/* Wire types                                                          */
/* ------------------------------------------------------------------ */

export interface ApiCompany {
  id: string;
  name: string;
  cashBalance: number;
  cashCurrency: string;
  /** How many holdings currently point at this company (gates deletion). */
  positionCount: number;
}

export interface CreateCompanyInput {
  name: string;
  cashBalance?: number;
  cashCurrency?: string;
}

export interface UpdateCompanyInput {
  name?: string;
  cashBalance?: number;
  cashCurrency?: string;
}

/* ------------------------------------------------------------------ */
/* Query                                                               */
/* ------------------------------------------------------------------ */

export function useCompanies() {
  return useQuery({
    queryKey: ["companies"],
    queryFn: () => fetchJson<{ companies: ApiCompany[] }>("/api/companies"),
  });
}

/* ------------------------------------------------------------------ */
/* Mutations                                                           */
/* ------------------------------------------------------------------ */

/**
 * A company change can affect the holdings table (it shows the company name)
 * and the headline cash total, so invalidate both lists.
 */
function useInvalidateCompanies() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ["companies"] });
    void qc.invalidateQueries({ queryKey: ["positions"] });
  };
}

async function parseError(res: Response): Promise<never> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  throw new Error(body.error ?? `Request failed (${res.status})`);
}

export function useCreateCompany() {
  const invalidate = useInvalidateCompanies();
  return useMutation({
    mutationFn: async (input: CreateCompanyInput) => {
      const res = await fetch("/api/companies", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) await parseError(res);
      return (await res.json()) as ApiCompany;
    },
    onSuccess: () => invalidate(),
  });
}

export function useUpdateCompany() {
  const invalidate = useInvalidateCompanies();
  return useMutation({
    mutationFn: async (args: { id: string; input: UpdateCompanyInput }) => {
      const res = await fetch(`/api/companies/${args.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(args.input),
      });
      if (!res.ok) await parseError(res);
      return (await res.json()) as ApiCompany;
    },
    onSuccess: () => invalidate(),
  });
}

export function useDeleteCompany() {
  const invalidate = useInvalidateCompanies();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/companies/${id}`, { method: "DELETE" });
      // 409 here means the company still owns holdings — surface the message.
      if (!res.ok) await parseError(res);
      return (await res.json()) as { ok: boolean };
    },
    onSuccess: () => invalidate(),
  });
}

/* ------------------------------------------------------------------ */
/* Derived: total cash in the display currency                         */
/* ------------------------------------------------------------------ */

/**
 * Sum of every company's cash, each converted from its own currency to the
 * display currency (PDR §9). Returns 0 while companies are still loading; the
 * convertCurrency helper already falls back to the raw amount on a cold FX
 * cache, so this never yields NaN.
 */
export function useCashValue(): number {
  const displayCurrency = useSettingsStore((s) => s.displayCurrency);
  const rates = useSettingsStore((s) => s.fxRates);
  const { data } = useCompanies();

  return useMemo(() => {
    const companies = data?.companies ?? [];
    return companies.reduce((sum, c) => {
      const v = convertCurrency(
        c.cashBalance ?? 0,
        c.cashCurrency ?? "USD",
        displayCurrency,
        rates,
      );
      return sum + (Number.isFinite(v) ? v : 0);
    }, 0);
  }, [data, displayCurrency, rates]);
}
