import { paginationOptsValidator } from "convex/server";
import { mutation, query } from "./_generated/server.js";
import { components } from "./_generated/api.js";
import { v } from "convex/values";
import { SecretStore } from "@gaganref/convex-secret-store";

const DEMO_KEYS = [
  { version: 2, value: "AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI=" },
  { version: 1, value: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=" },
] as const;

export const environmentValidator = v.union(
  v.literal("production"),
  v.literal("testing"),
);

export const providerValidator = v.union(
  v.literal("openai"),
  v.literal("anthropic"),
  v.literal("resend"),
  v.literal("stripe"),
  v.literal("slack"),
  v.literal("github"),
);

export type Namespace = `${string}:${"production" | "testing"}`;
export type Provider =
  | "openai"
  | "anthropic"
  | "resend"
  | "stripe"
  | "slack"
  | "github";

type ConnectionMetadata = {
  provider: Provider;
  label?: string;
  owner?: string;
  notes?: string;
};

const secrets = new SecretStore<{
  namespace: Namespace;
  metadata: ConnectionMetadata;
}>(components.secretStore, {
  keys: [...DEMO_KEYS],
});

const legacySecrets = new SecretStore<{
  namespace: Namespace;
  metadata: ConnectionMetadata;
}>(components.secretStore, {
  keys: [DEMO_KEYS[1]],
});

function toNamespace(
  workspace: string,
  environment: "production" | "testing",
): Namespace {
  const trimmed = workspace.trim();
  if (trimmed.length === 0) {
    throw new Error("workspace must not be empty");
  }
  return `${trimmed}:${environment}` as Namespace;
}

async function listAllConnections(
  ctx: Parameters<typeof secrets.list>[0],
  namespace: Namespace,
) {
  const rows: Array<
    Awaited<ReturnType<typeof secrets.list>>["page"][number]
  > = [];
  let cursor: string | null = null;

  while (true) {
    const result = await secrets.list(ctx, {
      namespace,
      paginationOpts: {
        numItems: 100,
        cursor,
      },
    });
    rows.push(...result.page);
    if (result.isDone) {
      return rows;
    }
    cursor = result.continueCursor;
  }
}

export const upsertConnection = mutation({
  args: {
    workspace: v.string(),
    environment: environmentValidator,
    provider: providerValidator,
    value: v.string(),
    label: v.optional(v.string()),
    owner: v.optional(v.string()),
    notes: v.optional(v.string()),
    ttlMs: v.optional(v.union(v.number(), v.null())),
  },
  returns: {
    secretId: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
    expiresAt: v.optional(v.number()),
    isNew: v.boolean(),
  },
  handler: async (ctx, args) => {
    return await secrets.put(ctx, {
      namespace: toNamespace(args.workspace, args.environment),
      name: args.provider,
      value: args.value,
      ttlMs: args.ttlMs,
      metadata: {
        provider: args.provider,
        label: args.label,
        owner: args.owner,
        notes: args.notes,
      },
    });
  },
});

export const updateConnection = mutation({
  args: {
    workspace: v.string(),
    environment: environmentValidator,
    provider: providerValidator,
    label: v.optional(v.union(v.string(), v.null())),
    owner: v.optional(v.union(v.string(), v.null())),
    notes: v.optional(v.union(v.string(), v.null())),
    expiresAt: v.optional(v.union(v.number(), v.null())),
  },
  returns: {
    updated: v.boolean(),
    updatedAt: v.optional(v.number()),
    expiresAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const loaded = await secrets.get(ctx, {
      namespace: toNamespace(args.workspace, args.environment),
      name: args.provider,
    });
    if (!loaded.ok) {
      return { updated: false };
    }

    return await secrets.update(ctx, {
      namespace: toNamespace(args.workspace, args.environment),
      name: args.provider,
      expiresAt: args.expiresAt,
      metadata: {
        provider: args.provider,
        label: args.label === null ? undefined : args.label ?? loaded.metadata?.label,
        owner: args.owner === null ? undefined : args.owner ?? loaded.metadata?.owner,
        notes: args.notes === null ? undefined : args.notes ?? loaded.metadata?.notes,
      },
    });
  },
});

export const listConnections = query({
  args: {
    workspace: v.string(),
    environment: environmentValidator,
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    return await secrets.list(ctx, {
      namespace: toNamespace(args.workspace, args.environment),
      paginationOpts: args.paginationOpts,
    });
  },
});

export const listActivity = query({
  args: {
    workspace: v.string(),
    environment: environmentValidator,
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    return await secrets.listEvents(ctx, {
      namespace: toNamespace(args.workspace, args.environment),
      paginationOpts: args.paginationOpts,
    });
  },
});

export const getMaintenanceSnapshot = query({
  args: {
    workspace: v.string(),
    environment: environmentValidator,
  },
  returns: {
    activeVersion: v.number(),
    configuredVersions: v.array(v.number()),
    totalSecrets: v.number(),
    expiredSecrets: v.number(),
    activeSecrets: v.number(),
    versionCounts: v.array(
      v.object({
        keyVersion: v.number(),
        count: v.number(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const rows = await listAllConnections(
      ctx,
      toNamespace(args.workspace, args.environment),
    );
    const versionCounts = new Map<number, number>();
    let expiredSecrets = 0;

    for (const row of rows) {
      versionCounts.set(
        row.keyVersion,
        (versionCounts.get(row.keyVersion) ?? 0) + 1,
      );
      if (row.effectiveState === "expired") {
        expiredSecrets += 1;
      }
    }

    return {
      activeVersion: DEMO_KEYS[0].version,
      configuredVersions: DEMO_KEYS.map((entry) => entry.version),
      totalSecrets: rows.length,
      expiredSecrets,
      activeSecrets: rows.length - expiredSecrets,
      versionCounts: Array.from(versionCounts.entries()).map(
        ([keyVersion, count]) => ({
          keyVersion,
          count,
        }),
      ),
    };
  },
});

export const seedLegacyConnection = mutation({
  args: {
    workspace: v.string(),
    environment: environmentValidator,
    provider: providerValidator,
    value: v.string(),
  },
  returns: {
    secretId: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
    expiresAt: v.optional(v.number()),
    isNew: v.boolean(),
  },
  handler: async (ctx, args) => {
    return await legacySecrets.put(ctx, {
      namespace: toNamespace(args.workspace, args.environment),
      name: args.provider,
      value: args.value,
      metadata: {
        provider: args.provider,
        label: "Legacy seeded secret",
        owner: "maintenance",
        notes: "Created with the previous KEK version for rotation demos.",
      },
    });
  },
});

export const removeConnection = mutation({
  args: {
    workspace: v.string(),
    environment: environmentValidator,
    provider: providerValidator,
  },
  returns: { removed: v.boolean() },
  handler: async (ctx, args) => {
    return await secrets.remove(ctx, {
      namespace: toNamespace(args.workspace, args.environment),
      name: args.provider,
    });
  },
});

export const runRotationBatch = mutation({
  args: {
    fromVersion: v.number(),
    batchSize: v.optional(v.number()),
    cursor: v.optional(v.union(v.string(), v.null())),
  },
  returns: {
    fromVersion: v.number(),
    toVersion: v.number(),
    processed: v.number(),
    rotated: v.number(),
    skipped: v.number(),
    isDone: v.boolean(),
    continueCursor: v.string(),
  },
  handler: async (ctx, args) => {
    return await secrets.rotateKeys(ctx, args);
  },
});

export const runCleanup = mutation({
  args: {
    retentionMs: v.optional(v.number()),
    batchSize: v.optional(v.number()),
  },
  returns: {
    deletedSecrets: v.number(),
    deletedEvents: v.number(),
    isDone: v.boolean(),
  },
  handler: async (ctx, args) => {
    return await secrets.cleanup(ctx, args);
  },
});
