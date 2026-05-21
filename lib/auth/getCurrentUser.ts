// Server helper: resolve the Auth.js session to the Mongo userId. Every
// per-user data route calls this and filters all queries by the returned id —
// the client-supplied id is never trusted (defense-in-depth vs IDOR).
// Refs: PDR.md §12; Tech_Stack.md §Authentication, §Security Notes.
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import type { OrgRole } from '@/types/pm';

/** Thrown when no valid session is present. */
export class UnauthorizedError extends Error {
  constructor(message = 'Unauthorized') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

/**
 * Resolve the current session's userId, or `null` when unauthenticated.
 * Use when the caller wants to branch instead of erroring.
 */
export async function getCurrentUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}

/**
 * Resolve the current session's userId or throw {@link UnauthorizedError}.
 * Use in data routes that must have an authenticated owner.
 */
export async function requireUserId(): Promise<string> {
  const userId = await getCurrentUserId();
  if (!userId) {
    throw new UnauthorizedError();
  }
  return userId;
}

/** Standard 401 JSON body for route handlers. */
export function unauthorizedResponse(): NextResponse {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

export interface PmContext {
  userId: string;
  orgId: string;
  roles: OrgRole[];
  /** Acting admin id when impersonation is active; otherwise null. */
  impersonatedBy: string | null;
}

/**
 * PM helper — returns the session's PM-scoped context. Used by every
 * `/api/pm/*` route. Throws when unauthenticated; returns null when the user
 * is authenticated but has no PM org yet (shouldn't happen after first sign-in
 * since the JWT callback auto-provisions one).
 */
export async function getPmContext(): Promise<PmContext | null> {
  const session = await auth();
  const u = session?.user;
  if (!u?.id) return null;
  if (!u.orgId) return null;
  return {
    userId: u.id,
    orgId: u.orgId,
    roles: u.roles ?? [],
    impersonatedBy: u.impersonatedBy ?? null,
  };
}

export default requireUserId;
