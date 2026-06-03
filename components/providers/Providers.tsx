"use client";

// Root client providers: Auth.js session context (client useSession) +
// TanStack Query (server-data owner). Query defaults follow Tech_Stack.md
// §Data Fetching — staleTime 60s for price-ish endpoints, refetch on focus.
import { useState, type ReactNode } from "react";
import { SessionProvider } from "next-auth/react";
import {
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { ToastProvider } from "@/components/ui/toast";
import { ErrorBoundary } from "@/components/providers/ErrorBoundary";
import { StoreHydrator } from "@/components/providers/StoreHydrator";

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60_000,
            refetchOnWindowFocus: true,
            retry: 1,
          },
        },
      }),
  );

  return (
    <SessionProvider>
      <QueryClientProvider client={queryClient}>
        {/* STATE-001/002: applies the persisted (skipHydration) Zustand stores
            after the first paint commits, so server and client markup match. */}
        <StoreHydrator />
        <ToastProvider>
          {/* STATE-012: section-level boundary so a thrown render error in one
              PM panel shows a recoverable fallback instead of blanking the
              whole shell (TopBar + Sidebar stay mounted). */}
          <ErrorBoundary>{children}</ErrorBoundary>
        </ToastProvider>
      </QueryClientProvider>
    </SessionProvider>
  );
}
