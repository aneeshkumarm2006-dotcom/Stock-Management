// Password hashing helpers. Refs: PDR.md §4, Tech_Stack.md §Authentication,
// §Security Notes — bcrypt cost >= 12; bcrypt.compare is constant-time.
import bcrypt from 'bcryptjs';

/** bcrypt work factor. Spec requires cost >= 12. */
const BCRYPT_COST = 12;

/** Hash a plaintext password with bcrypt (cost >= 12). */
export async function hashPassword(plaintext: string): Promise<string> {
  return bcrypt.hash(plaintext, BCRYPT_COST);
}

/**
 * Constant-time compare of a plaintext password against a stored bcrypt hash.
 * Returns false (never throws) when no hash is present so callers can treat a
 * missing hash (Google-only account) as an auth failure for the Credentials path.
 */
export async function verifyPassword(
  plaintext: string,
  hash: string | undefined | null,
): Promise<boolean> {
  if (!hash) {
    return false;
  }
  return bcrypt.compare(plaintext, hash);
}
