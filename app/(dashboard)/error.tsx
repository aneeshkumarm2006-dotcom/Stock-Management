"use client";

// Dashboard error boundary backstop. Catches render/runtime errors thrown by
// any dashboard route segment (including unhandled rejections that bubble into
// React) and renders a friendly retry surface instead of a blank screen.
import * as React from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    // Surface the error for observability; replace with real logger if present.
    console.error("Dashboard route error:", error);
  }, [error]);

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 px-4 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-error/10 text-error">
        <AlertTriangle className="h-6 w-6" />
      </div>
      <div className="space-y-1">
        <h2 className="text-lg font-bold text-fg">Something went wrong</h2>
        <p className="max-w-md text-sm text-fg-muted">
          This page hit an unexpected error and couldn&apos;t finish loading.
          You can try again, or reload if the problem persists.
        </p>
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={() => reset()}>
          Try again
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => window.location.reload()}
        >
          Reload page
        </Button>
      </div>
    </div>
  );
}
