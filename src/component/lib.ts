import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server.js";
import type { MutationCtx, QueryCtx } from "./_generated/server.js";
import { metadataValidator } from "../shared.js";
import { decryptSecret, encryptSecret } from "./crypto.js";
import { activeVersion, defaultTtlMs, getKEK, hasVersion } from "./keys.js";
import { resolveExpiresAt } from "./expiry.js";

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

function isExpired(secret: { expiresAt?: number }, now: number): boolean {
  return secret.expiresAt !== undefined && now >= secret.expiresAt;
}

/**
 * Encrypt and store a secret value, upserting by `namespace + name`.
 *
 * The plaintext is encrypted with a fresh per-secret DEK wrapped under the
 * active KEK; only ciphertext is persisted. Expiry is recomputed on every
 * write (ADR 0003). On overwrite, omitted `metadata` is preserved and `null`
 * clears it.
 */
export const put = mutation({
  args: {
    namespace: v.optional(v.string()),
    name: v.string(),
    value: v.string(),
    metadata: v.optional(v.union(metadataValidator, v.null())),
    ttlMs: v.optional(v.union(v.number(), v.null())),
  },
  returns: v.object({
    secretId: v.id("secrets"),
    createdAt: v.number(),
    updatedAt: v.number(),
    expiresAt: v.optional(v.number()),
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
    const expiresAt = resolveExpiresAt(now, args.ttlMs, defaultTtlMs());
    const existing = await findSecret(ctx, args.namespace, args.name);

    if (existing === null) {
      const secretId = await ctx.db.insert("secrets", {
        namespace: args.namespace,
        name: args.name,
        ...payload,
        keyVersion,
        ...(args.metadata != null ? { metadata: args.metadata } : {}),
        ...(expiresAt !== undefined ? { expiresAt } : {}),
        updatedAt: now,
      });
      return {
        secretId,
        createdAt: now,
        updatedAt: now,
        ...(expiresAt !== undefined ? { expiresAt } : {}),
        isNew: true,
      };
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
      expiresAt,
      updatedAt: now,
    });
    return {
      secretId: existing._id,
      createdAt: existing._creationTime,
      updatedAt: now,
      ...(expiresAt !== undefined ? { expiresAt } : {}),
      isNew: false,
    };
  },
});

/**
 * Load and decrypt a secret value.
 *
 * Expiry is evaluated against the caller-supplied `now` (ADR 0004). Returns
 * `not_found`, `expired`, or `key_unavailable` when the secret is unusable.
 */
export const get = query({
  args: {
    namespace: v.optional(v.string()),
    name: v.string(),
    now: v.number(),
  },
  returns: v.union(
    v.object({
      ok: v.literal(true),
      value: v.string(),
      metadata: v.optional(metadataValidator),
      expiresAt: v.optional(v.number()),
      updatedAt: v.number(),
    }),
    v.object({
      ok: v.literal(false),
      reason: v.union(
        v.literal("not_found"),
        v.literal("expired"),
        v.literal("key_unavailable"),
      ),
    }),
  ),
  handler: async (ctx, args) => {
    assertValidNamespace(args.namespace);
    const secret = await findSecret(ctx, args.namespace, args.name);
    if (secret === null) {
      return { ok: false as const, reason: "not_found" as const };
    }
    if (isExpired(secret, args.now)) {
      return { ok: false as const, reason: "expired" as const };
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
      expiresAt: secret.expiresAt,
      updatedAt: secret.updatedAt,
    };
  },
});

/**
 * Check whether a usable (existing, non-expired) secret is present.
 *
 * Expiry is evaluated against the caller-supplied `now` (ADR 0004).
 */
export const has = query({
  args: {
    namespace: v.optional(v.string()),
    name: v.string(),
    now: v.number(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    assertValidNamespace(args.namespace);
    const secret = await findSecret(ctx, args.namespace, args.name);
    return secret !== null && !isExpired(secret, args.now);
  },
});

/**
 * Update a secret's metadata or expiry without re-encrypting its value.
 *
 * Omitted fields are preserved; pass `null` to clear `metadata` or expiry, or
 * `ttlMs` to set expiry to `now + ttlMs`. Returns `updated: false` when the
 * secret does not exist or nothing was supplied to change.
 */
export const update = mutation({
  args: {
    namespace: v.optional(v.string()),
    name: v.string(),
    metadata: v.optional(v.union(metadataValidator, v.null())),
    ttlMs: v.optional(v.union(v.number(), v.null())),
  },
  returns: v.object({
    updated: v.boolean(),
    updatedAt: v.optional(v.number()),
    expiresAt: v.optional(v.number()),
  }),
  handler: async (ctx, args) => {
    assertValidNamespace(args.namespace);
    if (args.metadata === undefined && args.ttlMs === undefined) {
      return { updated: false as const };
    }
    const secret = await findSecret(ctx, args.namespace, args.name);
    if (secret === null) {
      return { updated: false as const };
    }

    const now = Date.now();
    const nextExpiresAt =
      args.ttlMs === undefined
        ? secret.expiresAt
        : resolveExpiresAt(now, args.ttlMs, null);

    const patch: {
      updatedAt: number;
      metadata?: Record<string, unknown>;
      expiresAt?: number;
    } = { updatedAt: now };
    if (args.metadata !== undefined) {
      patch.metadata = args.metadata === null ? undefined : args.metadata;
    }
    if (args.ttlMs !== undefined) {
      patch.expiresAt = nextExpiresAt;
    }
    await ctx.db.patch(secret._id, patch);

    return {
      updated: true as const,
      updatedAt: now,
      ...(nextExpiresAt !== undefined ? { expiresAt: nextExpiresAt } : {}),
    };
  },
});

/** Delete a secret. Returns `removed: false` when it does not exist. */
export const remove = mutation({
  args: {
    namespace: v.optional(v.string()),
    name: v.string(),
  },
  returns: v.object({ removed: v.boolean() }),
  handler: async (ctx, args) => {
    assertValidNamespace(args.namespace);
    const secret = await findSecret(ctx, args.namespace, args.name);
    if (secret === null) {
      return { removed: false };
    }
    await ctx.db.delete(secret._id);
    return { removed: true };
  },
});
