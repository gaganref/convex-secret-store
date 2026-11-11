import { ConvexError, v } from "convex/values";
import { mutation } from "./_generated/server.js";
import { api } from "./_generated/api.js";
import { recordEvent } from "./events.js";

/** Rows deleted per cleanup transaction. */
const CLEANUP_BATCH_SIZE = 100;

const cleanupResultValidator = v.object({
  deleted: v.number(),
  isDone: v.boolean(),
});

function assertPositiveRetention(retentionMs: number): void {
  if (!Number.isFinite(retentionMs) || retentionMs <= 0) {
    throw new ConvexError({
      code: "invalid_argument",
      message: `retentionMs must be a positive number, got ${retentionMs}`,
    });
  }
}

/**
 * Flag expired secrets and hard-delete those older than `retentionMs`.
 *
 * The flag also invalidates reactive queries for secrets written before
 * scheduled expiry. It adds no audit event (ADR 0005).
 * Deletes up to 100 secrets and flags up to 100 more per transaction, then
 * reschedules itself while a backlog remains. Records a `deleted` audit event
 * with reason `expired_cleanup` before each deletion. Secrets with no expiry
 * are never deleted.
 */
export const cleanupSecrets = mutation({
  args: { retentionMs: v.number() },
  returns: cleanupResultValidator,
  handler: async (ctx, args) => {
    assertPositiveRetention(args.retentionMs);
    const now = Date.now();
    const cutoff = now - args.retentionMs;
    const expired = await ctx.db
      .query("secrets")
      .withIndex("by_expires_at", (q) =>
        q.gte("expiresAt", 0).lt("expiresAt", cutoff),
      )
      .take(CLEANUP_BATCH_SIZE);

    for (const secret of expired) {
      await recordEvent(ctx, {
        secretId: secret._id,
        namespace: secret.namespace,
        name: secret.name,
        type: "deleted",
        metadata: { reason: "expired_cleanup" },
      });
      await ctx.db.delete("secrets", secret._id);
    }

    const unflagged = await ctx.db
      .query("secrets")
      .withIndex("by_expires_at", (q) =>
        q.gt("expiresAt", undefined).lte("expiresAt", now),
      )
      // eslint-disable-next-line @convex-dev/no-filter-in-query -- Rollback keeps the existing index.
      .filter((q) => q.eq(q.field("expiredAt"), undefined))
      .take(CLEANUP_BATCH_SIZE);
    for (const secret of unflagged) {
      await ctx.db.patch("secrets", secret._id, { expiredAt: now });
    }

    const isDone =
      expired.length < CLEANUP_BATCH_SIZE &&
      unflagged.length < CLEANUP_BATCH_SIZE;
    if (!isDone) {
      await ctx.scheduler.runAfter(0, api.cleanup.cleanupSecrets, {
        retentionMs: args.retentionMs,
      });
    }
    return { deleted: expired.length, isDone };
  },
});

/**
 * Hard-delete audit events older than `retentionMs`.
 *
 * Independent from secret cleanup — audit history may be retained longer than
 * the secrets it describes. Processes up to 100 rows per transaction and
 * reschedules itself while a backlog remains.
 */
export const cleanupEvents = mutation({
  args: { retentionMs: v.number() },
  returns: cleanupResultValidator,
  handler: async (ctx, args) => {
    assertPositiveRetention(args.retentionMs);
    const cutoff = Date.now() - args.retentionMs;
    const stale = await ctx.db
      .query("secretEvents")
      .withIndex("by_creation_time", (q) => q.lt("_creationTime", cutoff))
      .take(CLEANUP_BATCH_SIZE);

    for (const event of stale) {
      await ctx.db.delete("secretEvents", event._id);
    }

    const isDone = stale.length < CLEANUP_BATCH_SIZE;
    if (!isDone) {
      await ctx.scheduler.runAfter(0, api.cleanup.cleanupEvents, {
        retentionMs: args.retentionMs,
      });
    }
    return { deleted: stale.length, isDone };
  },
});
