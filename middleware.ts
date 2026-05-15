// Route protection. Uses the lightweight edge-safe `authConfig` (no Mongoose /
// adapter) — the `authorized` callback decides allow/redirect. JWT sessions
// mean no DB hit here. Refs: PDR.md §4; Tech_Stack.md §Authentication.
import NextAuth from 'next-auth';
import { authConfig } from '@/lib/auth/config';

export default NextAuth(authConfig).auth;

export const config = {
  // Run on everything except Next internals, the Auth.js routes, the Vercel
  // Cron endpoint, and static assets. /login, /signup are allowed through by
  // the `authorized` callback. `/api/cron/*` is excluded because Vercel Cron
  // requests carry no session cookie — that route enforces its own
  // `CRON_SECRET` shared-secret guard instead (Tech_Stack §Security Notes).
  matcher: [
    '/((?!api/auth|api/cron|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|css|js)$).*)',
  ],
};
