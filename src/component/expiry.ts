import { ConvexError } from "convex/values";

/**
 * Resolve a secret's absolute expiry timestamp for a write.
 *
 * Per ADR 0003, `put` recomputes expiry on every write:
 * - `ttlMs` a number  → `now + ttlMs`
 * - `ttlMs` `null`    → no expiry
 * - `ttlMs` omitted   → `now + defaultTtlMs` when a default is configured,
 *                        otherwise no expiry
 *
 * Returns the absolute `expiresAt`, or `undefined` for no expiry. Throws a
 * `ConvexError` with code `invalid_argument` when `ttlMs` is not a positive
 * integer. `0` is rejected because it would write an instantly-expired secret,
 * which is never a legitimate request (the write succeeds, the audit event is
 * recorded, and the next read returns `expired` — almost certainly a bug).
 */
export function resolveExpiresAt(
  now: number,
  ttlMs: number | null | undefined,
  defaultTtlMs: number | null,
): number | undefined {
  const effective = ttlMs === undefined ? defaultTtlMs : ttlMs;
  if (effective === null) {
    return undefined;
  }
  if (!Number.isInteger(effective) || effective <= 0) {
    throw new ConvexError({
      code: "invalid_argument",
      message: `ttlMs must be a positive integer or null, got ${effective}`,
    });
  }
  return now + effective;
}
