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

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: mongoAdapter,
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
