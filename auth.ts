// Auth.js entrypoint. Full (Node-runtime) config: edge-safe base + MongoDB
// adapter + Credentials provider (bcrypt + Mongoose lookup). Imported by route
// handlers and server helpers — never by `middleware.ts` (which uses the
// lightweight `authConfig` instead).
// Refs: PDR.md §3, §4; Tech_Stack.md §Authentication.
import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { z } from 'zod';
import { authConfig } from '@/lib/auth/config';
import { mongoAdapter } from '@/lib/auth/adapter';
import { verifyPassword } from '@/lib/auth/password';
import { connectToDatabase } from '@/lib/db/mongoose';
import { User } from '@/lib/db/models/User';
import { Settings } from '@/lib/db/models/Settings';
import { getOrCreateOrgForUser } from '@/lib/pm/org';
import type { OrgRole } from '@/types/pm';

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const baseJwt = authConfig.callbacks?.jwt;

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: mongoAdapter,
  callbacks: {
    ...authConfig.callbacks,
    // Node-runtime JWT enrichment: ensures every authenticated session
    // carries `orgId` + `roles` for PM scoping. Falls back to the edge-safe
    // callback for the common case where no DB lookup is needed.
    async jwt(params) {
      const token = (baseJwt ? await baseJwt(params) : params.token) ?? params.token;
      if (!token) return token;
      // `params.user` is only populated on the very first sign-in. After that
      // we hit the lazy path: if a stale JWT lacks orgId, look it up once.
      const needsOrg = !token.orgId && token.id;
      if (needsOrg) {
        try {
          const { orgId, roles } = await getOrCreateOrgForUser(String(token.id));
          token.orgId = orgId;
          token.roles = roles as OrgRole[];
        } catch (err) {
          console.error('jwt: getOrCreateOrgForUser failed', err);
        }
      }
      return token;
    },
  },
  events: {
    // Guarantee every user has a Settings doc from their first login onward
    // (Stage 7 / PDR §5.7). Runs server-side for *both* the Credentials and
    // Google paths, so the requirement holds regardless of how the user
    // signed in. Idempotent: $setOnInsert only writes defaults when absent,
    // and the unique { userId } index makes a concurrent insert a no-op.
    async signIn({ user }) {
      if (!user?.id) return;
      try {
        await connectToDatabase();
        await Settings.updateOne(
          { userId: user.id },
          {
            $setOnInsert: {
              userId: user.id,
              defaultCurrency: 'USD',
              theme: 'light',
              numberFormat: '1,234.56',
            },
          },
          { upsert: true },
        );
      } catch (err) {
        // Never block sign-in on settings provisioning; GET /api/settings
        // upserts the same default on first read as a backstop.
        console.error('signIn event: ensure Settings failed', err);
      }
    },
  },
  providers: [
    ...authConfig.providers,
    Credentials({
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) {
          return null;
        }

        const email = parsed.data.email.toLowerCase().trim();
        await connectToDatabase();

        const user = await User.findOne({ email }).lean();
        if (!user) {
          return null;
        }

        const ok = await verifyPassword(parsed.data.password, user.passwordHash);
        if (!ok) {
          return null;
        }

        return {
          id: String(user._id),
          email: user.email,
          name: user.name,
          image: user.image ?? null,
        };
      },
    }),
  ],
});
