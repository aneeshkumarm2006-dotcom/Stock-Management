// Shared chrome for the unauthenticated auth pages (login, signup). Centered
// card on the dark canvas with the subtle gradient-blob decor and legal
// footer from the Stitch references (site/design/login, site/design/signup).
// Route protection (logged-in users bounced to /dashboard) is handled by
// middleware.ts via authConfig.authorized — this layout is presentational.
// Refs: PDR.md §4, §12; site/design/login, site/design/signup, tokens.md.
import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden p-4">
      {/* Background decor — soft, low-opacity color wash (login reference). */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
      >
        <div className="absolute -left-[5%] -top-[10%] h-[40%] w-[40%] rounded-full bg-primary opacity-[0.04] blur-[120px]" />
        <div className="absolute -bottom-[10%] -right-[5%] h-[40%] w-[40%] rounded-full bg-gain opacity-[0.04] blur-[120px]" />
      </div>

      <main className="relative z-10 w-full max-w-[440px] animate-fade-in">
        {children}
      </main>

      <footer className="relative z-10 mt-8 flex justify-center gap-6">
        <span className="text-xs text-fg-muted/70">Privacy Policy</span>
        <span className="text-xs text-fg-muted/70">Terms of Service</span>
        <span className="text-xs text-fg-muted/70">Status</span>
      </footer>
    </div>
  );
}
