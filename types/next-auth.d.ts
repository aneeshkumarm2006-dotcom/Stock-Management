// Module augmentation so handlers can read `session.user.id` (the Mongo userId)
// with no DB hit. Refs: Tech_Stack.md §Authentication (userId embedded in JWT).
import type { DefaultSession } from 'next-auth';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
    } & DefaultSession['user'];
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id?: string;
  }
}
