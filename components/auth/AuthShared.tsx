// Bits shared by the login and signup cards: the PortfolioPro brand header
// and the "Continue with Google" button. Kept here so the two pages can't
// drift apart. Refs: site/design/login, site/design/signup, tokens.md.
"use client";

import { signIn } from "next-auth/react";
import { Wallet } from "lucide-react";

export function AuthBrand({ tagline }: { tagline: string }) {
  return (
    <header className="mb-10 flex flex-col items-center">
      <div className="mb-2 flex items-center gap-2">
        <Wallet className="h-7 w-7 text-primary" strokeWidth={2.25} />
        <h1 className="font-display text-2xl font-bold tracking-tight text-fg">
          PortfolioPro
        </h1>
      </div>
      <p className="text-sm text-fg-muted">{tagline}</p>
    </header>
  );
}

/**
 * Google OAuth button. Uses a full-page redirect (Auth.js default) so the
 * session cookie is set on the browser response; lands on `callbackUrl`.
 */
export function GoogleButton({
  callbackUrl,
  disabled,
}: {
  callbackUrl: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => void signIn("google", { callbackUrl })}
      className="flex w-full items-center justify-center gap-3 rounded-md border border-border bg-transparent py-3 text-sm font-medium text-fg transition-colors hover:bg-surface-high disabled:pointer-events-none disabled:opacity-50"
    >
      <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden>
        <path
          d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
          fill="#4285F4"
        />
        <path
          d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
          fill="#34A853"
        />
        <path
          d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
          fill="#FBBC05"
        />
        <path
          d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
          fill="#EA4335"
        />
      </svg>
      Continue with Google
    </button>
  );
}

/** Section divider with a centered "OR" (both auth references). */
export function OrDivider() {
  return (
    <div className="my-8 flex items-center">
      <div className="flex-grow border-t border-border/40" />
      <span className="mx-4 text-xs font-medium uppercase tracking-widest text-fg-muted/60">
        or
      </span>
      <div className="flex-grow border-t border-border/40" />
    </div>
  );
}
