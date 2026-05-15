"use client";

// Settings data layer (PDR §5.7). The server Settings doc (/api/settings) is
// the source of truth; useSettingsStore mirrors it client-side so the currency
// / number-format preference reflows every page instantly without a round-trip
// (Stage 6 comment in store/useSettingsStore.ts). On app load we hydrate the
// store from the server doc; edits write through to the server AND the store.
//
//   GET  /api/settings        → display preferences (default-created)
//   PUT  /api/settings        → persist a preference change
//   GET  /api/usage           → per-provider quota for the status panel
//   POST /api/import          → CSV import (per-row report)
//   GET  /api/export          → CSV export (download)
//   DELETE /api/positions/clear → wipe the user's positions
import { useEffect } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useSettingsStore } from "@/store/useSettingsStore";
import type { Currency } from "@/lib/utils/convertCurrency";
import type { NumberFormat } from "@/lib/utils/formatNumber";
import type { Theme } from "@/store/useSettingsStore";

/* ------------------------------------------------------------------ */
/* Wire types                                                          */
/* ------------------------------------------------------------------ */

export interface ServerSettings {
  defaultCurrency: Currency;
  theme: Theme;
  numberFormat: NumberFormat;
}

export interface ProviderUsage {
  provider: "twelvedata" | "finnhub" | "exchangerate";
  used: number;
  limit: number | null;
  ratio: number;
  soft: boolean;
  hard: boolean;
  label: string;
  callsPerMinute: number | null;
  callsPerMonth: number | null;
}

export interface ImportRowError {
  row: number;
  message: string;
}

export interface ImportResult {
  committed: number;
  failed: number;
  total: number;
  errors: ImportRowError[];
}

/* ------------------------------------------------------------------ */
/* Fetcher                                                             */
/* ------------------------------------------------------------------ */

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      /* non-JSON error body — keep the status message */
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

/* ------------------------------------------------------------------ */
/* Settings: query + cross-app hydration                               */
/* ------------------------------------------------------------------ */

export function useSettingsQuery() {
  return useQuery({
    queryKey: ["settings"],
    queryFn: () => fetchJson<ServerSettings>("/api/settings"),
    // Preferences change rarely; the mutation refreshes this explicitly.
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Mounted once in the dashboard shell. Pulls the authoritative server doc and
 * mirrors it into the Zustand store so the currency toggle / number format /
 * theme re-apply on every page (Settings DoD: "persist and re-apply across
 * pages"). The store is also localStorage-persisted, so this only overwrites
 * it when the server actually answers — an offline load keeps the last prefs.
 */
export function useSettingsSync() {
  const query = useSettingsQuery();
  const hydrateFromServer = useSettingsStore((s) => s.hydrateFromServer);
  const theme = useSettingsStore((s) => s.theme);

  useEffect(() => {
    if (query.data) hydrateFromServer(query.data);
  }, [query.data, hydrateFromServer]);

  // Reflect the theme preference on <html>. v1 ships dark-only styling
  // (globals.css / tokens.md); the class is still toggled so the preference is
  // honored the moment a light theme is added — see DisplayPreferences note.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    root.classList.toggle("light", theme === "light");
  }, [theme]);

  return query;
}

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<ServerSettings>) => {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }
      return (await res.json()) as ServerSettings;
    },
    onSuccess: (data) => {
      // Keep the query cache in lockstep with the persisted doc.
      qc.setQueryData(["settings"], data);
    },
  });
}

/* ------------------------------------------------------------------ */
/* API usage panel                                                     */
/* ------------------------------------------------------------------ */

export function useUsageQuery() {
  return useQuery({
    queryKey: ["usage"],
    queryFn: () =>
      fetchJson<{ providers: ProviderUsage[] }>("/api/usage"),
    // "Live" usage bars (PDR §5.7) — refresh while the page is open.
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}

/* ------------------------------------------------------------------ */
/* Data management: import / clear                                     */
/* ------------------------------------------------------------------ */

function useInvalidatePositions() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ["positions"] });
    void qc.invalidateQueries({ queryKey: ["quote"] });
  };
}

export function useImportPositions() {
  const invalidate = useInvalidatePositions();
  return useMutation({
    mutationFn: async (csv: string): Promise<ImportResult> => {
      const res = await fetch("/api/import", {
        method: "POST",
        headers: { "content-type": "text/csv" },
        body: csv,
      });
      const body = (await res.json().catch(() => ({}))) as
        | ImportResult
        | { error?: string };

      // 200 = all/most committed, 422 = parsed but nothing valid: both are a
      // row-level report the UI shows inline, not a thrown error. Anything
      // else (400 bad header / empty, 401) is a hard failure.
      if (res.status === 200 || res.status === 422) {
        return body as ImportResult;
      }
      throw new Error(
        ("error" in body && body.error) || `Import failed (${res.status})`,
      );
    },
    onSuccess: (result) => {
      if (result.committed > 0) invalidate();
    },
  });
}

export function useClearAllData() {
  const invalidate = useInvalidatePositions();
  return useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/positions/clear", { method: "DELETE" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }
      return (await res.json()) as { deleted: number };
    },
    onSuccess: () => invalidate(),
  });
}
