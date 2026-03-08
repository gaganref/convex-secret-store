import { ConvexError, v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { paginator } from "convex-helpers/server/pagination";
import { mutation, query } from "./_generated/server.js";
import type { MutationCtx } from "./_generated/server.js";
import type { Doc, Id } from "./_generated/dataModel.js";
import schema from "./schema.js";
import {
  effectiveStateValidator,
  metadataValidator,
  orderValidator,
  secretEventTypeValidator,
} from "../shared.js";

type SecretDoc = Doc<"secrets">;
type SecretEventDoc = Doc<"secretEvents">;
type SecretReplacement = Omit<SecretDoc, "_id" | "_creationTime">;

function effectiveState(secret: SecretDoc, now: number): "active" | "expired" {
  return secret.expiresAt !== undefined && now >= secret.expiresAt
    ? "expired"
    : "active";
}

function mapSecretRow(secret: SecretDoc, now: number) {
  return {
    secretId: secret._id,
    namespace: secret.namespace,
    name: secret.name,
    metadata: secret.metadata,
    createdAt: secret._creationTime,
    updatedAt: secret.updatedAt,
    expiresAt: secret.expiresAt,
    effectiveState: effectiveState(secret, now),
    keyVersion: secret.keyVersion,
  };
}

function mapEventRow(event: SecretEventDoc) {
  return {
    eventId: event._id,
    secretId: event.secretId,
    namespace: event.namespace,
    name: event.name,
    type: event.type,
    metadata: event.metadata,
    createdAt: event.createdAt,
  };
}

async function recordEvent(
  ctx: MutationCtx,
  event: {
    secretId: Id<"secrets">;
    namespace: string | undefined;
    name: string;
    type: "created" | "updated" | "deleted" | "rotated";
    metadata?: Record<string, any>;
  },
) {
  await ctx.db.insert("secretEvents", {
    secretId: event.secretId,
    namespace: event.namespace,
    name: event.name,
    type: event.type,
    metadata: event.metadata,
    createdAt: Date.now(),
  });
}

function assertNullableNonNegativeInteger(
  value: number | null | undefined,
  field: string,
) {
  if (value === undefined || value === null) {
    return;
  }
  if (!Number.isInteger(value) || value < 0) {
    throw new ConvexError({
      code: "invalid_argument",
      message: `${field} must be a non-negative integer or null`,
    });
  }
}

async function getSecretByName(
  ctx: { db: any },
  namespace: string | undefined,
  name: string,
) {
  return await ctx.db
    .query("secrets")
    .withIndex("by_namespace_and_name", (q: any) =>
      q.eq("namespace", namespace).eq("name", name),
    )
    .unique();
}

const failureReasonValidator = v.union(
  v.literal("not_found"),
  v.literal("expired"),
);

const putResultValidator = v.object({
  secretId: v.id("secrets"),
  createdAt: v.number(),
  updatedAt: v.number(),
  expiresAt: v.optional(v.number()),
  isNew: v.boolean(),
});

const getResultValidator = v.union(
  v.object({
    ok: v.literal(true),
    encryptedValue: v.string(),
    iv: v.string(),
    wrappedDEK: v.string(),
    dekIv: v.string(),
    keyVersion: v.number(),
    metadata: v.optional(metadataValidator),
    expiresAt: v.optional(v.number()),
    updatedAt: v.number(),
  }),
  v.object({
    ok: v.literal(false),
    reason: failureReasonValidator,
  }),
);

const removeResultValidator = v.object({
  removed: v.boolean(),
});

const updateResultValidator = v.object({
  updated: v.boolean(),
  updatedAt: v.optional(v.number()),
  expiresAt: v.optional(v.number()),
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

const listResultValidator = v.object({
  page: v.array(listItemValidator),
  isDone: v.boolean(),
  continueCursor: v.string(),
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

const listEventsResultValidator = v.object({
  page: v.array(eventItemValidator),
  isDone: v.boolean(),
  continueCursor: v.string(),
});

const listByKeyVersionItemValidator = v.object({
  secretId: v.id("secrets"),
  namespace: v.optional(v.string()),
  name: v.string(),
  wrappedDEK: v.string(),
  dekIv: v.string(),
  keyVersion: v.number(),
  updatedAt: v.number(),
});

const listByKeyVersionResultValidator = v.object({
  page: v.array(listByKeyVersionItemValidator),
  isDone: v.boolean(),
  continueCursor: v.string(),
});

const updateWrappedDEKResultValidator = v.union(
  v.object({
    ok: v.literal(true),
    updatedAt: v.number(),
  }),
  v.object({
    ok: v.literal(false),
    reason: v.union(v.literal("not_found"), v.literal("stale")),
  }),
);

const cleanupResultValidator = v.object({
  deletedSecrets: v.number(),
  deletedEvents: v.number(),
  isDone: v.boolean(),
});

export const put = mutation({
  args: {
    namespace: v.optional(v.string()),
    name: v.string(),
    encryptedValue: v.string(),
    iv: v.string(),
    wrappedDEK: v.string(),
    dekIv: v.string(),
    keyVersion: v.number(),
    metadata: v.optional(v.union(metadataValidator, v.null())),
    expiresAt: v.optional(v.union(v.number(), v.null())),
  },
  returns: putResultValidator,
  handler: async (ctx, args) => {
    assertNullableNonNegativeInteger(args.expiresAt, "expiresAt");
    const existing = await getSecretByName(ctx, args.namespace, args.name);
    const now = Date.now();

    if (existing === null) {
      const secretId = await ctx.db.insert("secrets", {
        namespace: args.namespace,
        name: args.name,
        encryptedValue: args.encryptedValue,
        iv: args.iv,
        wrappedDEK: args.wrappedDEK,
        dekIv: args.dekIv,
        keyVersion: args.keyVersion,
        ...(args.metadata !== undefined && args.metadata !== null
          ? { metadata: args.metadata }
          : {}),
        ...(typeof args.expiresAt === "number"
          ? { expiresAt: args.expiresAt }
          : {}),
        updatedAt: now,
      });
      await recordEvent(ctx, {
        secretId,
        namespace: args.namespace,
        name: args.name,
        type: "created",
        metadata:
          args.metadata !== undefined && args.metadata !== null
            ? args.metadata
            : undefined,
      });
      return {
        secretId,
        createdAt: now,
        updatedAt: now,
        ...(typeof args.expiresAt === "number"
          ? { expiresAt: args.expiresAt }
          : {}),
        isNew: true,
      };
    }

    const { _id: _existingId, _creationTime: _existingCreatedAt, ...stored } =
      existing;
    const replacement: SecretReplacement = {
      ...stored,
      namespace: args.namespace,
      name: args.name,
      encryptedValue: args.encryptedValue,
      iv: args.iv,
      wrappedDEK: args.wrappedDEK,
      dekIv: args.dekIv,
      keyVersion: args.keyVersion,
      updatedAt: now,
    };
    if (args.metadata === null) {
      delete replacement.metadata;
    } else if (args.metadata !== undefined) {
      replacement.metadata = args.metadata;
    }
    if (args.expiresAt === null) {
      delete replacement.expiresAt;
    } else if (args.expiresAt !== undefined) {
      replacement.expiresAt = args.expiresAt;
    }

    await ctx.db.replace(existing._id, replacement);
    await recordEvent(ctx, {
      secretId: existing._id,
      namespace: args.namespace,
      name: args.name,
      type: "updated",
      metadata:
        args.metadata !== undefined && args.metadata !== null
          ? args.metadata
          : undefined,
    });
    return {
      secretId: existing._id,
      createdAt: existing._creationTime,
      updatedAt: now,
      ...(replacement.expiresAt !== undefined
        ? { expiresAt: replacement.expiresAt as number }
        : {}),
      isNew: false,
    };
  },
});

export const get = query({
  args: {
    namespace: v.optional(v.string()),
    name: v.string(),
    now: v.number(),
  },
  returns: getResultValidator,
  handler: async (ctx, args) => {
    const secret = await getSecretByName(ctx, args.namespace, args.name);
    if (secret === null) {
      return { ok: false as const, reason: "not_found" as const };
    }
    if (secret.expiresAt !== undefined && args.now >= secret.expiresAt) {
      return { ok: false as const, reason: "expired" as const };
    }
    return {
      ok: true as const,
      encryptedValue: secret.encryptedValue,
      iv: secret.iv,
      wrappedDEK: secret.wrappedDEK,
      dekIv: secret.dekIv,
      keyVersion: secret.keyVersion,
      metadata: secret.metadata,
      expiresAt: secret.expiresAt,
      updatedAt: secret.updatedAt,
    };
  },
});

export const has = query({
  args: {
    namespace: v.optional(v.string()),
    name: v.string(),
    now: v.number(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const secret = await getSecretByName(ctx, args.namespace, args.name);
    if (secret === null) {
      return false;
    }
    return !(secret.expiresAt !== undefined && args.now >= secret.expiresAt);
  },
});

export const remove = mutation({
  args: {
    namespace: v.optional(v.string()),
    name: v.string(),
  },
  returns: removeResultValidator,
  handler: async (ctx, args) => {
    const secret = await getSecretByName(ctx, args.namespace, args.name);
    if (secret === null) {
      return { removed: false };
    }
    await recordEvent(ctx, {
      secretId: secret._id,
      namespace: secret.namespace,
      name: secret.name,
      type: "deleted",
      metadata: { deletedReason: "explicit_remove" },
    });
    await ctx.db.delete(secret._id);
    return { removed: true };
  },
});

export const update = mutation({
  args: {
    namespace: v.optional(v.string()),
    name: v.string(),
    metadata: v.optional(v.union(metadataValidator, v.null())),
    expiresAt: v.optional(v.union(v.number(), v.null())),
  },
  returns: updateResultValidator,
  handler: async (ctx, args) => {
    if (args.metadata === undefined && args.expiresAt === undefined) {
      return { updated: false };
    }
    assertNullableNonNegativeInteger(args.expiresAt, "expiresAt");
    const secret = await getSecretByName(ctx, args.namespace, args.name);
    if (secret === null) {
      return { updated: false };
    }

    const { _id: _secretId, _creationTime: _secretCreatedAt, ...stored } =
      secret;
    const replacement: SecretReplacement = {
      ...stored,
      updatedAt: Date.now(),
    };
    if (args.metadata === null) {
      delete replacement.metadata;
    } else if (args.metadata !== undefined) {
      replacement.metadata = args.metadata;
    }
    if (args.expiresAt === null) {
      delete replacement.expiresAt;
    } else if (args.expiresAt !== undefined) {
      replacement.expiresAt = args.expiresAt;
    }
    await ctx.db.replace(secret._id, replacement);
    await recordEvent(ctx, {
      secretId: secret._id,
      namespace: secret.namespace,
      name: secret.name,
      type: "updated",
      metadata:
        args.metadata !== undefined && args.metadata !== null
          ? args.metadata
          : undefined,
    });
    return {
      updated: true,
      updatedAt: replacement.updatedAt as number,
      ...(replacement.expiresAt !== undefined
        ? { expiresAt: replacement.expiresAt as number }
        : {}),
    };
  },
});

export const list = query({
  args: {
    namespace: v.optional(v.string()),
    paginationOpts: paginationOptsValidator,
    order: orderValidator,
    now: v.number(),
  },
  returns: listResultValidator,
  handler: async (ctx, args) => {
    const result = await paginator(ctx.db, schema)
      .query("secrets")
      .withIndex("by_namespace_and_updated_at", (q) =>
        q.eq("namespace", args.namespace),
      )
      .order(args.order ?? "desc")
      .paginate(args.paginationOpts);

    return {
      page: result.page.map((secret) => mapSecretRow(secret, args.now)),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

export const listEvents = query({
  args: {
    paginationOpts: paginationOptsValidator,
    secretId: v.optional(v.id("secrets")),
    namespace: v.optional(v.string()),
    name: v.optional(v.string()),
    type: v.optional(secretEventTypeValidator),
    order: orderValidator,
  },
  returns: listEventsResultValidator,
  handler: async (ctx, args) => {
    const hasSecretId = args.secretId !== undefined;
    const hasName = args.name !== undefined;
    const hasType = args.type !== undefined;
    if (hasSecretId && (args.namespace !== undefined || hasName || hasType)) {
      throw new ConvexError({
        code: "invalid_argument",
        message: "secretId cannot be combined with namespace, name, or type",
      });
    }
    if (hasName && hasType) {
      throw new ConvexError({
        code: "invalid_argument",
        message: "name and type cannot be combined in V1",
      });
    }
    if ((hasName || hasType) && args.namespace === undefined) {
      throw new ConvexError({
        code: "invalid_argument",
        message: "namespace is required when filtering by name or type",
      });
    }

    const pages = paginator(ctx.db, schema).query("secretEvents");
    const order = args.order ?? "desc";
    const result = hasSecretId
      ? await pages
          .withIndex("by_secret_id_and_created_at", (q) =>
            q.eq("secretId", args.secretId!),
          )
          .order(order)
          .paginate(args.paginationOpts)
      : hasName
        ? await pages
            .withIndex("by_namespace_and_name_and_created_at", (q) =>
              q.eq("namespace", args.namespace!).eq("name", args.name!),
            )
            .order(order)
            .paginate(args.paginationOpts)
        : hasType
          ? await pages
              .withIndex("by_namespace_and_type_and_created_at", (q) =>
                q.eq("namespace", args.namespace!).eq("type", args.type!),
              )
              .order(order)
              .paginate(args.paginationOpts)
          : await pages
              .withIndex("by_namespace_and_created_at", (q) =>
                q.eq("namespace", args.namespace),
              )
              .order(order)
              .paginate(args.paginationOpts);

    return {
      page: result.page.map(mapEventRow),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

export const listByKeyVersion = query({
  args: {
    fromVersion: v.number(),
    paginationOpts: paginationOptsValidator,
    order: orderValidator,
  },
  returns: listByKeyVersionResultValidator,
  handler: async (ctx, args) => {
    const result = await paginator(ctx.db, schema)
      .query("secrets")
      .withIndex("by_key_version", (q) => q.eq("keyVersion", args.fromVersion))
      .order(args.order ?? "desc")
      .paginate(args.paginationOpts);

    return {
      page: result.page.map((secret) => ({
        secretId: secret._id,
        namespace: secret.namespace,
        name: secret.name,
        wrappedDEK: secret.wrappedDEK,
        dekIv: secret.dekIv,
        keyVersion: secret.keyVersion,
        updatedAt: secret.updatedAt,
      })),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

export const updateWrappedDEK = mutation({
  args: {
    secretId: v.id("secrets"),
    expectedKeyVersion: v.number(),
    expectedUpdatedAt: v.number(),
    wrappedDEK: v.string(),
    dekIv: v.string(),
    keyVersion: v.number(),
  },
  returns: updateWrappedDEKResultValidator,
  handler: async (ctx, args) => {
    const secret = await ctx.db.get(args.secretId);
    if (secret === null) {
      return { ok: false as const, reason: "not_found" as const };
    }
    if (
      secret.keyVersion !== args.expectedKeyVersion ||
      secret.updatedAt !== args.expectedUpdatedAt
    ) {
      return { ok: false as const, reason: "stale" as const };
    }

    const updatedAt = Date.now();
    await ctx.db.patch(secret._id, {
      wrappedDEK: args.wrappedDEK,
      dekIv: args.dekIv,
      keyVersion: args.keyVersion,
      updatedAt,
    });
    await recordEvent(ctx, {
      secretId: secret._id,
      namespace: secret.namespace,
      name: secret.name,
      type: "rotated",
      metadata: {
        previousKeyVersion: args.expectedKeyVersion,
        newKeyVersion: args.keyVersion,
      },
    });
    return { ok: true as const, updatedAt };
  },
});

export const cleanup = mutation({
  args: {
    retentionMs: v.number(),
    batchSize: v.number(),
  },
  returns: cleanupResultValidator,
  handler: async (ctx, args) => {
    if (!Number.isInteger(args.retentionMs) || args.retentionMs <= 0) {
      throw new ConvexError({
        code: "invalid_argument",
        message: "retentionMs must be a positive integer",
      });
    }
    if (!Number.isInteger(args.batchSize) || args.batchSize <= 0) {
      throw new ConvexError({
        code: "invalid_argument",
        message: "batchSize must be a positive integer",
      });
    }

    const now = Date.now();
    const expiredSecrets = await ctx.db
      .query("secrets")
      .withIndex("by_expires_at", (q) => q.gte("expiresAt", 0).lt("expiresAt", now))
      .take(args.batchSize);

    for (const secret of expiredSecrets) {
      await recordEvent(ctx, {
        secretId: secret._id,
        namespace: secret.namespace,
        name: secret.name,
        type: "deleted",
        metadata: { deletedReason: "expired_cleanup" },
      });
      await ctx.db.delete(secret._id);
    }

    const cutoff = now - args.retentionMs;
    const oldEvents = await ctx.db
      .query("secretEvents")
      .withIndex("by_created_at", (q) => q.lt("createdAt", cutoff))
      .take(args.batchSize);
    for (const event of oldEvents) {
      await ctx.db.delete(event._id);
    }

    return {
      deletedSecrets: expiredSecrets.length,
      deletedEvents: oldEvents.length,
      isDone:
        expiredSecrets.length < args.batchSize && oldEvents.length < args.batchSize,
    };
  },
});
