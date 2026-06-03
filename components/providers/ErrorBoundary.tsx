"use client";

// STATE-012: section-level React error boundary. Sits inside Providers wrapping
// `children` so a thrown render error in one PM panel (e.g. a malformed date in
// ActivityLog or an undefined customFields map) is caught here and shows a
// recoverable fallback, instead of unmounting the whole dashboard tree and
// falling back to Next.js's page-level error UI (which would also blank the
// TopBar and Sidebar).
import * as React from "react";

interface Props {
  children: React.ReactNode;
  /** Optional custom fallback renderer. */
  fallback?: (error: Error, reset: () => void) => React.ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Surface to the console for debugging; a real telemetry sink can hook here.
    if (process.env.NODE_ENV !== "production") {
      // eslint-disable-next-line no-console
      console.error("ErrorBoundary caught:", error, info.componentStack);
    }
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (error) {
      if (this.props.fallback) return this.props.fallback(error, this.reset);
      return (
        <div
          role="alert"
          className="m-6 rounded border border-error/40 bg-error/5 p-6 text-sm"
        >
          <p className="font-bold text-error">Something went wrong.</p>
          <p className="mt-1 text-fg-muted">
            This section failed to render. The rest of the app is still
            available.
          </p>
          <button
            type="button"
            onClick={this.reset}
            className="mt-3 rounded border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-fg transition-colors hover:bg-surface-lowest"
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
