import { ConvexError, v } from "convex/values";
import {
  internalMutation,
  mutation,
  type MutationCtx,
} from "./_generated/server.js";
import { internal } from "./_generated/api.js";
import { recordEvent } from "./events.js";

/** Rows deleted per cleanup transaction. */
const CLEANUP_BATCH_SIZE = 100;
const READ_RESERVE = 8 * 1024 * 1024;

async function hasReadBudget(ctx: MutationCtx): Promise<boolean> {
  try {
    return (
      (await ctx.meta.getTransactionMetrics()).bytesRead.remaining >
      READ_RESERVE
    );
  } catch {
    // Older test runtimes do not implement transaction metrics.
    return true;
  }
}

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
 * Hard-delete expired secrets whose expiry is older than `retentionMs`.
 *
 * Processes up to 100 rows per transaction and reschedules itself while a
 * backlog remains. Records a `deleted` audit event with reason
 * `expired_cleanup` before each deletion. Secrets with no expiry are never
 * deleted.
 */
const secretsBatch = {
  args: { retentionMs: v.number() },
  returns: cleanupResultValidator,
  handler: async (ctx: MutationCtx, args: { retentionMs: number }) => {
    assertPositiveRetention(args.retentionMs);
    const cutoff = Date.now() - args.retentionMs;
    const expired = ctx.db
      .query("secrets")
      .withIndex("by_expires_at", (q) =>
        q.gte("expiresAt", 0).lt("expiresAt", cutoff),
      );

    let deleted = 0;
    let isDone = true;
    for await (const secret of expired) {
      await recordEvent(ctx, {
        secretId: secret._id,
        namespace: secret.namespace,
        name: secret.name,
        type: "deleted",
        metadata: { reason: "expired_cleanup" },
      });
      await ctx.db.delete("secrets", secret._id);
      deleted++;
      if (deleted === CLEANUP_BATCH_SIZE || !(await hasReadBudget(ctx))) {
        isDone = false;
        break;
      }
    }

    if (!isDone) {
      await ctx.scheduler.runAfter(0, internal.cleanup.continueSecrets, {
        retentionMs: args.retentionMs,
      });
    }
    return { deleted, isDone };
  },
};

/**
 * Hard-delete audit events older than `retentionMs`.
 *
 * Independent from secret cleanup. Audit history may be retained longer than
 * the secrets it describes. Processes up to 100 rows per transaction and
 * reschedules itself while a backlog remains.
 */
const eventsBatch = {
  args: { retentionMs: v.number() },
  returns: cleanupResultValidator,
  handler: async (ctx: MutationCtx, args: { retentionMs: number }) => {
    assertPositiveRetention(args.retentionMs);
    const cutoff = Date.now() - args.retentionMs;
    const stale = ctx.db
      .query("secretEvents")
      .withIndex("by_creation_time", (q) => q.lt("_creationTime", cutoff));

    let deleted = 0;
    let isDone = true;
    for await (const event of stale) {
      await ctx.db.delete("secretEvents", event._id);
      deleted++;
      if (deleted === CLEANUP_BATCH_SIZE || !(await hasReadBudget(ctx))) {
        isDone = false;
        break;
      }
    }

    if (!isDone) {
      await ctx.scheduler.runAfter(0, internal.cleanup.continueEvents, {
        retentionMs: args.retentionMs,
      });
    }
    return { deleted, isDone };
  },
};

export const cleanupSecrets = mutation(secretsBatch);
export const cleanupEvents = mutation(eventsBatch);
export const continueSecrets = internalMutation(secretsBatch);
export const continueEvents = internalMutation(eventsBatch);
