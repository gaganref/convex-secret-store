import { ConvexError, v } from "convex/values";
import { internalMutation, type MutationCtx } from "./_generated/server.js";
import type { Id } from "./_generated/dataModel.js";
import { internal } from "./_generated/api.js";

// Stay one day inside Convex's five-year scheduling horizon.
const MAX_EXPIRY_SCHEDULE_DELAY_MS = (5 * 365 - 1) * 24 * 60 * 60 * 1000;
const HOST_SCHEDULING_RESERVE = 500;

export async function scheduleExpiry(
  ctx: MutationCtx,
  secretId: Id<"secrets">,
  expiresAt: number | undefined,
  now: number,
): Promise<void> {
  if (
    expiresAt === undefined ||
    expiresAt - now > MAX_EXPIRY_SCHEDULE_DELAY_MS
  ) {
    return;
  }
  let remaining: number | undefined;
  try {
    remaining = (await ctx.meta.getTransactionMetrics()).functionsScheduled
      .remaining;
  } catch {
    // Older test runtimes do not implement transaction metrics.
  }
  if (remaining !== undefined && remaining <= HOST_SCHEDULING_RESERVE) {
    return;
  }
  await ctx.scheduler.runAt(expiresAt, internal.expiry.expire, {
    secretId,
    expiresAt,
  });
}

export const expire = internalMutation({
  args: { secretId: v.id("secrets"), expiresAt: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const secret = await ctx.db.get("secrets", args.secretId);
    if (
      secret === null ||
      secret.expiresAt !== args.expiresAt ||
      secret.expiredAt !== undefined
    ) {
      return null;
    }
    await ctx.db.patch("secrets", secret._id, { expiredAt: Date.now() });
    return null;
  },
});

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
