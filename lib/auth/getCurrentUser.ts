// Server helper: resolve the Auth.js session to the Mongo userId. Every
// per-user data route calls this and filters all queries by the returned id —
// the client-supplied id is never trusted (defense-in-depth vs IDOR).
// Refs: PDR.md §12; Tech_Stack.md §Authentication, §Security Notes.
import { NextResponse } from 'next/server';
import { auth } from '@/auth';

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

export default requireUserId;
