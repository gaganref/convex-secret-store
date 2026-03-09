import { v } from "convex/values";
import { internalAction, type ActionCtx } from "./_generated/server.js";
import {
  configuredDemoVersions,
  secrets,
  activeDemoVersion,
} from "./lib/secretStore.js";

const ROTATION_BATCH_SIZE = 100;

async function drainVersion(ctx: ActionCtx, fromVersion: number) {
  let cursor: string | null = null;
  let processed = 0;
  let rotated = 0;
  let skipped = 0;

  while (true) {
    const result = await secrets.rotateKeys(ctx, {
      fromVersion,
      batchSize: ROTATION_BATCH_SIZE,
      cursor,
    });

    processed += result.processed;
    rotated += result.rotated;
    skipped += result.skipped;

    if (result.isDone) {
      return {
        fromVersion,
        toVersion: result.toVersion,
        processed,
        rotated,
        skipped,
      };
    }

    cursor = result.continueCursor ?? null;
  }
}

export const rotateSecretStoreVersion = internalAction({
  args: {
    fromVersion: v.number(),
  },
  returns: v.object({
    fromVersion: v.number(),
    toVersion: v.number(),
    processed: v.number(),
    rotated: v.number(),
    skipped: v.number(),
  }),
  handler: async (ctx, args) => {
    return await drainVersion(ctx, args.fromVersion);
  },
});

export const rotateSecretStoreToLatest = internalAction({
  args: {},
  returns: v.object({
    activeVersion: v.number(),
    drainedVersions: v.array(
      v.object({
        fromVersion: v.number(),
        toVersion: v.number(),
        processed: v.number(),
        rotated: v.number(),
        skipped: v.number(),
      }),
    ),
  }),
  handler: async (ctx) => {
    const drainedVersions: Array<{
      fromVersion: number;
      toVersion: number;
      processed: number;
      rotated: number;
      skipped: number;
    }> = [];
    for (const fromVersion of configuredDemoVersions.slice(1)) {
      drainedVersions.push(await drainVersion(ctx, fromVersion));
    }

    return {
      activeVersion: activeDemoVersion,
      drainedVersions,
    };
  },
});
