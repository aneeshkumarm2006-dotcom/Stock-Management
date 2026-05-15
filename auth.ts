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

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: mongoAdapter,
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
              theme: 'dark',
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
