// Sign-in-as-user helpers (DECISIONS.md [G-B-6]). Server reads/writes the
// `impersonatedBy` JWT claim via NextAuth's `update()` trigger from the
// `POST /api/pm/impersonate` route; this module only normalises the shape.
import type { Session } from 'next-auth';

export interface ImpersonationState {
  /** Effective user id used by data queries while impersonation is active. */
  effectiveUserId: string;
  /** Original admin id (always present when impersonatedBy is set). */
  actingAdminId: string | null;
  /** True when the session is currently impersonating someone. */
  active: boolean;
}

export function readImpersonation(
  session: Session | null,
): ImpersonationState | null {
  if (!session?.user?.id) return null;
  const impersonatedBy = session.user.impersonatedBy ?? null;
  return {
    effectiveUserId: session.user.id,
    actingAdminId: impersonatedBy,
    active: Boolean(impersonatedBy),
  };
}
