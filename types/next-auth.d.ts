// Module augmentation so handlers can read `session.user.id` (the Mongo userId)
// with no DB hit. Phase 0 also surfaces the PM `orgId`, `roles`, and an
// optional `impersonatedBy` claim used by the Admin "Sign in as user" flow
// (DECISIONS.md [G-B-6]).
// Refs: Tech_Stack.md §Authentication (userId embedded in JWT);
//       PROPERTY_TODO.md Phase 0 §Auth & User.
import type { DefaultSession } from 'next-auth';
import type { OrgRole } from '@/types/pm';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      /** PM org for the signed-in user (auto-provisioned on first sign-in). */
      orgId?: string;
      /** Membership roles within `orgId`. Empty when not a PM user. */
      roles?: OrgRole[];
      /**
       * When set, the session is impersonating another user. The acting
       * admin's id is preserved here so the activity log can attribute
       * actions correctly (Admin-only flow).
       */
      impersonatedBy?: string;
    } & DefaultSession['user'];
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id?: string;
    orgId?: string;
    roles?: OrgRole[];
    impersonatedBy?: string;
  }
}
