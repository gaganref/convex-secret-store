import { v } from "convex/values";
import { internalMutation, type MutationCtx } from "./_generated/server.js";
import { internal } from "./_generated/api.js";
import { activeVersion, getKEK, hasVersion } from "./keys.js";
import { rewrapDEK } from "./crypto.js";
import { recordEvent } from "./events.js";

const BATCH_SIZE = 100;
const READ_RESERVE = 8 * 1024 * 1024;

export const rotationResultValidator = v.object({
  rotated: v.number(),
  skipped: v.number(),
  isDone: v.boolean(),
  orphanVersions: v.optional(v.array(v.number())),
});

const positionValidator = v.union(
  v.object({ kind: v.literal("scan"), afterVersion: v.optional(v.number()) }),
  v.object({
    kind: v.literal("rotate"),
    version: v.number(),
    cursor: v.union(v.string(), v.null()),
  }),
);

type Position = typeof positionValidator.type;

async function readBudget(ctx: MutationCtx): Promise<number> {
  try {
    return Math.max(
      0,
      (await ctx.meta.getTransactionMetrics()).bytesRead.remaining -
        READ_RESERVE,
    );
  } catch {
    // Older test runtimes do not implement transaction metrics.
    return READ_RESERVE;
  }
}

/** One native page preserves the full index position, including tied timestamps. */
export async function rotateBatch(
  ctx: MutationCtx,
  position: Position = { kind: "scan" },
  expectedActive = activeVersion(),
) {
  const active = activeVersion();
  if (expectedActive !== active) position = { kind: "scan" };
  let rotated = 0;
  let skipped = 0;
  const orphanVersions: number[] = [];
  let scanned = 0;

  async function finish(next: Position | null) {
    if (next !== null) {
      await ctx.scheduler.runAfter(0, internal.rotation.continueRotation, {
        active,
        position: next,
      });
    }
    return {
      rotated,
      skipped,
      isDone: next === null,
      ...(orphanVersions.length > 0 ? { orphanVersions } : {}),
    };
  }

  while (position.kind === "scan") {
    if (scanned === BATCH_SIZE || (await readBudget(ctx)) === 0)
      return await finish(position);
    const after = position.afterVersion;
    const secret = await ctx.db
      .query("secrets")
      .withIndex("by_key_version", (q) =>
        after === undefined ? q : q.gt("keyVersion", after),
      )
      .first();
    if (secret === null) return await finish(null);
    scanned++;
    const version = secret.keyVersion;
    position = { kind: "scan", afterVersion: version };
    if (version === active) continue;
    if (!hasVersion(version)) {
      orphanVersions.push(version);
      continue;
    }
    position = { kind: "rotate", version, cursor: null };
  }

  // A key may be removed between scheduled batches. Skip its entire range.
  if (!hasVersion(position.version) || position.version === active) {
    if (!hasVersion(position.version)) orphanVersions.push(position.version);
    return await finish({ kind: "scan", afterVersion: position.version });
  }
  const budget = await readBudget(ctx);
  if (budget === 0) return await finish(position);
  const { version, cursor } = position;
  // Patching may read each secret again; leave half the read budget for writes.
  const page = await ctx.db
    .query("secrets")
    .withIndex("by_key_version", (q) => q.eq("keyVersion", version))
    .paginate({
      numItems: BATCH_SIZE,
      cursor,
      maximumBytesRead: Math.ceil(budget / 2),
    });
  const toKek = await getKEK(active);
  const fromKek = await getKEK(version);
  for (const secret of page.page) {
    let rewrapped;
    try {
      rewrapped = await rewrapDEK({
        wrappedDEK: secret.wrappedDEK,
        dekIv: secret.dekIv,
        namespace: secret.namespace,
        name: secret.name,
        fromVersion: version,
        toVersion: active,
        fromKek,
        toKek,
      });
    } catch {
      skipped++;
      continue;
    }
    await ctx.db.patch("secrets", secret._id, {
      wrappedDEK: rewrapped.wrappedDEK,
      dekIv: rewrapped.dekIv,
      keyVersion: active,
    });
    await recordEvent(ctx, {
      secretId: secret._id,
      namespace: secret.namespace,
      name: secret.name,
      type: "rotated",
      metadata: { fromVersion: version, toVersion: active },
    });
    rotated++;
  }
  if (!page.isDone) {
    return await finish({
      kind: "rotate",
      version,
      cursor: page.continueCursor,
    });
  }
  // Look past the completed version without retrying its failed unwraps.
  let afterVersion = version;
  while (scanned < BATCH_SIZE && (await readBudget(ctx)) > 0) {
    const next = await ctx.db
      .query("secrets")
      .withIndex("by_key_version", (q) => q.gt("keyVersion", afterVersion))
      .first();
    if (next === null) return await finish(null);
    scanned++;
    afterVersion = next.keyVersion;
    if (afterVersion === active) continue;
    if (!hasVersion(afterVersion)) {
      orphanVersions.push(afterVersion);
      continue;
    }
    return await finish({
      kind: "rotate",
      version: afterVersion,
      cursor: null,
    });
  }
  return await finish({ kind: "scan", afterVersion });
}

export const continueRotation = internalMutation({
  args: { active: v.number(), position: positionValidator },
  returns: rotationResultValidator,
  handler: async (ctx, args) =>
    await rotateBatch(ctx, args.position, args.active),
});
