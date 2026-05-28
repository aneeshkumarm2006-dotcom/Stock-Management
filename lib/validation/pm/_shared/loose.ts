// Shared Zod helpers for the "presence is optional, but type/format still
// enforced" pattern. Use these instead of `z.string().min(1).max(N)` so the
// conversion-to-warnings stays consistent across schemas.
import { z } from 'zod';

/** Optional trimmed string capped at `max` chars. Empty string allowed
 *  (becomes the value `""`, which compute-warnings will treat as missing). */
export function looseString(max: number = 8000) {
  return z.string().max(max).optional();
}

/** Optional enum: accepts any value in the tuple, or omission. */
export function looseEnum<T extends readonly [string, ...string[]]>(values: T) {
  return z.enum(values).optional();
}
