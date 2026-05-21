import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server.js";
import type { MutationCtx, QueryCtx } from "./_generated/server.js";
import { metadataValidator } from "../shared.js";
import { decryptSecret, encryptSecret } from "./crypto.js";
import { activeVersion, getKEK, hasVersion } from "./keys.js";

/** Maximum plaintext value size — well under Convex's document limit. */
const MAX_VALUE_BYTES = 64 * 1024;
const byteCounter = new TextEncoder();

function assertValidNamespace(namespace: string | undefined): void {
  if (namespace === "") {
    throw new ConvexError({
      code: "invalid_argument",
      message: "namespace must not be empty",
    });
  }
}

async function findSecret(
  ctx: QueryCtx | MutationCtx,
  namespace: string | undefined,
  name: string,
) {
  return await ctx.db
    .query("secrets")
    .withIndex("by_namespace_and_name", (q) =>
      q.eq("namespace", namespace).eq("name", name),
    )
    .unique();
}

/**
 * Encrypt and store a secret value, upserting by `namespace + name`.
 *
 * The plaintext is encrypted with a fresh per-secret DEK wrapped under the
 * active KEK; only ciphertext is persisted. On overwrite, omitted `metadata` is
 * preserved and `null` clears it.
 */
export const put = mutation({
  args: {
    namespace: v.optional(v.string()),
    name: v.string(),
    value: v.string(),
    metadata: v.optional(v.union(metadataValidator, v.null())),
  },
  returns: v.object({
    secretId: v.id("secrets"),
    createdAt: v.number(),
    updatedAt: v.number(),
    isNew: v.boolean(),
  }),
  handler: async (ctx, args) => {
    assertValidNamespace(args.namespace);
    if (byteCounter.encode(args.value).byteLength > MAX_VALUE_BYTES) {
      throw new ConvexError({
        code: "value_too_large",
        message: `secret value exceeds the ${MAX_VALUE_BYTES}-byte limit`,
      });
    }

    const keyVersion = activeVersion();
    const payload = await encryptSecret({
      value: args.value,
      namespace: args.namespace,
      name: args.name,
      keyVersion,
      kek: await getKEK(keyVersion),
    });
    const now = Date.now();
    const existing = await findSecret(ctx, args.namespace, args.name);

    if (existing === null) {
      const secretId = await ctx.db.insert("secrets", {
        namespace: args.namespace,
        name: args.name,
        ...payload,
        keyVersion,
        ...(args.metadata != null ? { metadata: args.metadata } : {}),
        updatedAt: now,
      });
      return { secretId, createdAt: now, updatedAt: now, isNew: true };
    }

    const nextMetadata =
      args.metadata === undefined
        ? existing.metadata
        : args.metadata === null
          ? undefined
          : args.metadata;
    await ctx.db.patch(existing._id, {
      ...payload,
      keyVersion,
      metadata: nextMetadata,
      updatedAt: now,
    });
    return {
      secretId: existing._id,
      createdAt: existing._creationTime,
      updatedAt: now,
      isNew: false,
    };
  },
});

/**
 * Load and decrypt a secret value.
 *
 * Returns `not_found` when no row exists, or `key_unavailable` when the row's
 * key version is no longer configured.
 */
export const get = query({
  args: {
    namespace: v.optional(v.string()),
    name: v.string(),
  },
  returns: v.union(
    v.object({
      ok: v.literal(true),
      value: v.string(),
      metadata: v.optional(metadataValidator),
      updatedAt: v.number(),
    }),
    v.object({
      ok: v.literal(false),
      reason: v.union(v.literal("not_found"), v.literal("key_unavailable")),
    }),
  ),
  handler: async (ctx, args) => {
    assertValidNamespace(args.namespace);
    const secret = await findSecret(ctx, args.namespace, args.name);
    if (secret === null) {
      return { ok: false as const, reason: "not_found" as const };
    }
    if (!hasVersion(secret.keyVersion)) {
      return { ok: false as const, reason: "key_unavailable" as const };
    }

    let value: string;
    try {
      value = await decryptSecret({
        encryptedValue: secret.encryptedValue,
        iv: secret.iv,
        wrappedDEK: secret.wrappedDEK,
        dekIv: secret.dekIv,
        namespace: secret.namespace,
        name: secret.name,
        keyVersion: secret.keyVersion,
        kek: await getKEK(secret.keyVersion),
      });
    } catch {
      throw new ConvexError({
        code: "decryption_failed",
        message: `failed to decrypt secret "${args.name}"`,
      });
    }

    return {
      ok: true as const,
      value,
      metadata: secret.metadata,
      updatedAt: secret.updatedAt,
    };
  },
});
