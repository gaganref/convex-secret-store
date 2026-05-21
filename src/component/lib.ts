import { ConvexError, v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { paginator } from "convex-helpers/server/pagination";
import { mutation, query } from "./_generated/server.js";
import type { MutationCtx, QueryCtx } from "./_generated/server.js";
import schema from "./schema.js";
import {
  effectiveStateValidator,
  metadataValidator,
  orderValidator,
  secretEventTypeValidator,
} from "../shared.js";
import { decryptSecret, encryptSecret } from "./crypto.js";
import { activeVersion, defaultTtlMs, getKEK, hasVersion } from "./keys.js";
import { resolveExpiresAt } from "./expiry.js";
import { recordEvent } from "./events.js";

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
 * clears it. Records a `created` or `updated` audit event.
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
      await recordEvent(ctx, {
        secretId,
        namespace: args.namespace,
        name: args.name,
        type: "created",
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
    await recordEvent(ctx, {
      secretId: existing._id,
      namespace: args.namespace,
      name: args.name,
      type: "updated",
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

const listItemValidator = v.object({
  secretId: v.id("secrets"),
  namespace: v.optional(v.string()),
  name: v.string(),
  metadata: v.optional(metadataValidator),
  createdAt: v.number(),
  updatedAt: v.number(),
  expiresAt: v.optional(v.number()),
  effectiveState: effectiveStateValidator,
  keyVersion: v.number(),
});

/**
 * Paginate secrets in a namespace, newest-updated first.
 *
 * Each row carries `effectiveState` (evaluated against the caller-supplied
 * `now`, per ADR 0004) so callers can distinguish active from expired secrets
 * without an extra query. The decrypted value is never included.
 */
export const list = query({
  args: {
    namespace: v.optional(v.string()),
    paginationOpts: paginationOptsValidator,
    order: orderValidator,
    now: v.number(),
  },
  returns: v.object({
    page: v.array(listItemValidator),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    assertValidNamespace(args.namespace);
    const result = await paginator(ctx.db, schema)
      .query("secrets")
      .withIndex("by_namespace_and_updated_at", (q) =>
        q.eq("namespace", args.namespace),
      )
      .order(args.order ?? "desc")
      .paginate(args.paginationOpts);

    return {
      page: result.page.map((secret) => ({
        secretId: secret._id,
        namespace: secret.namespace,
        name: secret.name,
        metadata: secret.metadata,
        createdAt: secret._creationTime,
        updatedAt: secret.updatedAt,
        expiresAt: secret.expiresAt,
        effectiveState: isExpired(secret, args.now)
          ? ("expired" as const)
          : ("active" as const),
        keyVersion: secret.keyVersion,
      })),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

/**
 * Update a secret's metadata or expiry without re-encrypting its value.
 *
 * Omitted fields are preserved; pass `null` to clear `metadata` or expiry, or
 * `ttlMs` to set expiry to `now + ttlMs`. Returns `updated: false` when the
 * secret does not exist or nothing was supplied to change. Records an
 * `updated` audit event when a change is applied.
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
    await recordEvent(ctx, {
      secretId: secret._id,
      namespace: secret.namespace,
      name: secret.name,
      type: "updated",
    });

    return {
      updated: true as const,
      updatedAt: now,
      ...(nextExpiresAt !== undefined ? { expiresAt: nextExpiresAt } : {}),
    };
  },
});

/**
 * Delete a secret. Records a `deleted` audit event with reason `removed`.
 * Returns `removed: false` when the secret does not exist.
 */
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
    await recordEvent(ctx, {
      secretId: secret._id,
      namespace: secret.namespace,
      name: secret.name,
      type: "deleted",
      metadata: { reason: "removed" },
    });
    await ctx.db.delete(secret._id);
    return { removed: true };
  },
});

const eventItemValidator = v.object({
  eventId: v.id("secretEvents"),
  secretId: v.id("secrets"),
  namespace: v.optional(v.string()),
  name: v.string(),
  type: secretEventTypeValidator,
  metadata: v.optional(metadataValidator),
  createdAt: v.number(),
});

/**
 * Paginate audit events.
 *
 * Filter by `secretId`, or by `namespace` optionally narrowed with `name` or
 * `type`. V1 restrictions: `secretId` cannot combine with the other filters,
 * `name` and `type` cannot combine, and `name`/`type` require `namespace`.
 */
export const listEvents = query({
  args: {
    namespace: v.optional(v.string()),
    secretId: v.optional(v.id("secrets")),
    name: v.optional(v.string()),
    type: v.optional(secretEventTypeValidator),
    paginationOpts: paginationOptsValidator,
    order: orderValidator,
  },
  returns: v.object({
    page: v.array(eventItemValidator),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    assertValidNamespace(args.namespace);
    const { secretId, namespace, name, type } = args;

    if (
      secretId !== undefined &&
      (namespace !== undefined || name !== undefined || type !== undefined)
    ) {
      throw new ConvexError({
        code: "invalid_argument",
        message: "secretId cannot be combined with namespace, name, or type",
      });
    }
    if (name !== undefined && type !== undefined) {
      throw new ConvexError({
        code: "invalid_argument",
        message: "name and type cannot be combined",
      });
    }
    if ((name !== undefined || type !== undefined) && namespace === undefined) {
      throw new ConvexError({
        code: "invalid_argument",
        message: "namespace is required when filtering by name or type",
      });
    }

    const order = args.order ?? "desc";
    const events = paginator(ctx.db, schema).query("secretEvents");

    let result;
    if (secretId !== undefined) {
      result = await events
        .withIndex("by_secret_id", (q) => q.eq("secretId", secretId))
        .order(order)
        .paginate(args.paginationOpts);
    } else if (name !== undefined) {
      result = await events
        .withIndex("by_namespace_and_name", (q) =>
          q.eq("namespace", namespace).eq("name", name),
        )
        .order(order)
        .paginate(args.paginationOpts);
    } else if (type !== undefined) {
      result = await events
        .withIndex("by_namespace_and_type", (q) =>
          q.eq("namespace", namespace).eq("type", type),
        )
        .order(order)
        .paginate(args.paginationOpts);
    } else {
      result = await events
        .withIndex("by_namespace", (q) => q.eq("namespace", namespace))
        .order(order)
        .paginate(args.paginationOpts);
    }

    return {
      page: result.page.map((event) => ({
        eventId: event._id,
        secretId: event.secretId,
        namespace: event.namespace,
        name: event.name,
        type: event.type,
        metadata: event.metadata,
        createdAt: event._creationTime,
      })),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});
