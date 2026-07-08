"use client";

// Brokers data layer — the per-user brokerage/custodian entities a holding can
// be held at (used to "split by broker"). Mirrors useCompanies.ts: TanStack
// Query owns the server read; every mutation invalidates BOTH ["brokers"] and
// ["positions"], because the holdings table renders the broker name.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchJson } from "@/lib/utils/apiFetch";

export interface ApiBroker {
  id: string;
  name: string;
  /** How many holdings currently point at this broker (gates deletion). */
  positionCount: number;
}

export interface CreateBrokerInput {
  name: string;
}

export interface UpdateBrokerInput {
  name: string;
}

export function useBrokers() {
  return useQuery({
    queryKey: ["brokers"],
    queryFn: () => fetchJson<{ brokers: ApiBroker[] }>("/api/brokers"),
  });
}

/**
 * A broker change affects the holdings table (it shows the broker name), so
 * invalidate both lists.
 */
function useInvalidateBrokers() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ["brokers"] });
    void qc.invalidateQueries({ queryKey: ["positions"] });
  };
}

async function parseError(res: Response): Promise<never> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  throw new Error(body.error ?? `Request failed (${res.status})`);
}

export function useCreateBroker() {
  const invalidate = useInvalidateBrokers();
  return useMutation({
    mutationFn: async (input: CreateBrokerInput) => {
      const res = await fetch("/api/brokers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) await parseError(res);
      return (await res.json()) as ApiBroker;
    },
    onSuccess: () => invalidate(),
  });
}

export function useUpdateBroker() {
  const invalidate = useInvalidateBrokers();
  return useMutation({
    mutationFn: async (args: { id: string; input: UpdateBrokerInput }) => {
      const res = await fetch(`/api/brokers/${args.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(args.input),
      });
      if (!res.ok) await parseError(res);
      return (await res.json()) as ApiBroker;
    },
    onSuccess: () => invalidate(),
  });
}

export function useDeleteBroker() {
  const invalidate = useInvalidateBrokers();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/brokers/${id}`, { method: "DELETE" });
      // 409 here means the broker still owns holdings — surface the message.
      if (!res.ok) await parseError(res);
      return (await res.json()) as { ok: boolean };
    },
    onSuccess: () => invalidate(),
  });
}
