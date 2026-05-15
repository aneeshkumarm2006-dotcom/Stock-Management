// Edge-safe base Auth.js config: providers/callbacks/session shape that the
// middleware can import without pulling in Mongoose or the adapter (Node-only).
// The Credentials provider + MongoDB adapter are layered on in `auth.ts`.
// Refs: PDR.md §3, §4; Tech_Stack.md §Authentication, §Security Notes.
import type { NextAuthConfig } from 'next-auth';
import Google from 'next-auth/providers/google';

const THIRTY_DAYS_SECONDS = 60 * 60 * 24 * 30;
const isProd = process.env.NODE_ENV === 'production';

/** Routes reachable without a session (Auth.js routes are excluded via matcher). */
const PUBLIC_PATHS = new Set(['/login', '/signup']);

export const authConfig: NextAuthConfig = {
  // JWT sessions: Node-runtime safe and lets handlers read session.user.id
  // straight from the token with no DB round-trip. Sliding 30-day expiry.
  session: {
    strategy: 'jwt',
    maxAge: THIRTY_DAYS_SECONDS,
  },
  pages: {
    signIn: '/login',
  },
  cookies: {
    sessionToken: {
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: isProd,
      },
    },
  },
  trustHost: true,
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      // Same verified email across Credentials + Google resolves to one
      // `users` document (PDR §3 account-linking requirement).
      allowDangerousEmailAccountLinking: true,
    }),
  ],
  callbacks: {
    // Centralized route protection consumed by `middleware.ts`. Unauthenticated
    // users may only reach /login and /signup; logged-in users hitting those
    // are bounced to the dashboard. Everything else requires a session.
    authorized({ request, auth }) {
      const { pathname } = request.nextUrl;
      const isLoggedIn = Boolean(auth?.user);
      const isPublic = PUBLIC_PATHS.has(pathname);

      if (isPublic) {
        if (isLoggedIn) {
          return Response.redirect(new URL('/dashboard', request.nextUrl));
        }
        return true;
      }

      // Returning false makes Auth.js redirect to `pages.signIn` (/login).
      return isLoggedIn;
    },
    // On sign-in, persist the Mongo user id into the token. For Credentials the
    // `authorize` return carries it; for Google the adapter-created user id.
    jwt({ token, user }) {
      if (user?.id) {
        token.id = user.id;
      }
      return token;
    },
    // Expose the id on the session object for server-side user scoping.
    session({ session, token }) {
      if (token.id && session.user) {
        session.user.id = String(token.id);
      }
      return session;
    },
  },
};

export default authConfig;
