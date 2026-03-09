import { mutation } from "./_generated/server.js";
import type { MutationCtx } from "./_generated/server.js";
import { api } from "./_generated/api.js";
import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel.js";

const SECRET_BATCH_SIZE = 100;
const EVENT_BATCH_SIZE = 100;

const cleanupResultValidator = v.object({
  deleted: v.number(),
  isDone: v.boolean(),
});

function assertRetentionMs(retentionMs: number) {
  if (!Number.isFinite(retentionMs) || retentionMs <= 0) {
    throw new ConvexError({
      code: "invalid_argument",
      message: `retentionMs must be a positive finite number, got ${retentionMs}`,
    });
  }
}

async function recordExpiredCleanupEvent(
  ctx: MutationCtx,
  secret: {
    _id: Id<"secrets">;
    namespace?: string;
    name: string;
  },
) {
  await ctx.db.insert("secretEvents", {
    secretId: secret._id,
    namespace: secret.namespace,
    name: secret.name,
    type: "deleted",
    metadata: { deletedReason: "expired_cleanup" },
    createdAt: Date.now(),
  });
}

async function cleanupSecretsImpl(ctx: MutationCtx, retentionMs: number) {
  assertRetentionMs(retentionMs);
  const now = Date.now();
  const cutoff = now - retentionMs;

  const expiredSecrets = await ctx.db
    .query("secrets")
    .withIndex("by_expires_at", (q) =>
      q.gte("expiresAt", 0).lt("expiresAt", cutoff),
    )
    .take(SECRET_BATCH_SIZE);

  for (const secret of expiredSecrets) {
    await recordExpiredCleanupEvent(ctx, secret);
    await ctx.db.delete(secret._id);
  }

  const deleted = expiredSecrets.length;
  const isDone = deleted < SECRET_BATCH_SIZE;

  if (!isDone) {
    await ctx.scheduler.runAfter(0, api.cleanup.cleanupSecrets, {
      retentionMs,
    });
  }

  return { deleted, isDone };
}

async function cleanupEventsImpl(ctx: MutationCtx, retentionMs: number) {
  assertRetentionMs(retentionMs);
  const cutoff = Date.now() - retentionMs;

  const oldEvents = await ctx.db
    .query("secretEvents")
    .withIndex("by_created_at", (q) => q.lt("createdAt", cutoff))
    .take(EVENT_BATCH_SIZE);

  for (const event of oldEvents) {
    await ctx.db.delete(event._id);
  }

  const deleted = oldEvents.length;
  const isDone = deleted < EVENT_BATCH_SIZE;

  if (!isDone) {
    await ctx.scheduler.runAfter(0, api.cleanup.cleanupEvents, {
      retentionMs,
    });
  }

  return { deleted, isDone };
}

/**
 * Hard-deletes expired secrets older than `retentionMs`.
 *
 * The component treats `expiresAt` as the point when a secret becomes unusable.
 * This cleanup deletes only rows whose expiry timestamp is older than the
 * retention window, and records a final `deleted` audit event with
 * `deletedReason: "expired_cleanup"` before deletion.
 */
export const cleanupSecrets = mutation({
  args: { retentionMs: v.number() },
  returns: cleanupResultValidator,
  handler: async (ctx, { retentionMs }) => {
    return await cleanupSecretsImpl(ctx, retentionMs);
  },
});

/**
 * Hard-deletes audit events older than `retentionMs`.
 *
 * Event cleanup is independent from secret cleanup. Audit rows may outlive
 * their parent secrets until this retention window expires.
 */
export const cleanupEvents = mutation({
  args: { retentionMs: v.number() },
  returns: cleanupResultValidator,
  handler: async (ctx, { retentionMs }) => {
    return await cleanupEventsImpl(ctx, retentionMs);
  },
});
