import { paginationOptsValidator } from "convex/server";
import { mutation, query } from "./_generated/server.js";
import { components } from "./_generated/api.js";
import { v } from "convex/values";
import { SecretStore } from "convex-secret-store";

const DEMO_KEYS = [
  { version: 2, value: "AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI=" },
  { version: 1, value: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=" },
] as const;

export const environmentValidator = v.union(
  v.literal("development"),
  v.literal("staging"),
  v.literal("production"),
);

export type Environment = "development" | "staging" | "production";
export type Namespace = `${string}:${Environment}`;

const secrets = new SecretStore<{
  namespace: Namespace;
  metadata: Record<string, string>;
}>(components.secretStore, {
  keys: [...DEMO_KEYS],
});

const legacySecrets = new SecretStore<{
  namespace: Namespace;
  metadata: Record<string, string>;
}>(components.secretStore, {
  keys: [DEMO_KEYS[1]],
});

function toNamespace(workspace: string, environment: Environment): Namespace {
  const trimmed = workspace.trim();
  if (trimmed.length === 0) {
    throw new Error("workspace must not be empty");
  }
  return `${trimmed}:${environment}` as Namespace;
}

function maskSecret(value: string) {
  if (value.length <= 8) {
    return "\u2022".repeat(value.length);
  }
  return `${value.slice(0, 4)}\u2022\u2022\u2022\u2022${value.slice(-4)}`;
}

// ---------------------------------------------------------------------------
// Secrets CRUD
// ---------------------------------------------------------------------------

export const putSecret = mutation({
  args: {
    workspace: v.string(),
    environment: environmentValidator,
    name: v.string(),
    value: v.string(),
    ttlMs: v.optional(v.union(v.number(), v.null())),
    metadata: v.optional(v.union(v.object({}), v.null())),
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
      name: args.name,
      value: args.value,
      ttlMs: args.ttlMs,
      metadata: args.metadata === null ? null : undefined,
    });
  },
});

export const removeSecret = mutation({
  args: {
    workspace: v.string(),
    environment: environmentValidator,
    name: v.string(),
  },
  returns: { removed: v.boolean() },
  handler: async (ctx, args) => {
    return await secrets.remove(ctx, {
      namespace: toNamespace(args.workspace, args.environment),
      name: args.name,
    });
  },
});

export const listSecrets = query({
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

// ---------------------------------------------------------------------------
// Server-side preview (row action)
// ---------------------------------------------------------------------------

export const previewSecret = query({
  args: {
    workspace: v.string(),
    environment: environmentValidator,
    name: v.string(),
  },
  returns: v.object({
    name: v.string(),
    resolution: v.union(
      v.literal("active"),
      v.literal("expired"),
      v.literal("missing"),
    ),
    serverNote: v.string(),
    maskedValue: v.optional(v.string()),
    updatedAt: v.optional(v.number()),
    expiresAt: v.optional(v.number()),
  }),
  handler: async (ctx, args) => {
    const loaded = await secrets.get(ctx, {
      namespace: toNamespace(args.workspace, args.environment),
      name: args.name,
    });

    if (!loaded.ok) {
      return {
        name: args.name,
        resolution:
          loaded.reason === "expired"
            ? ("expired" as const)
            : ("missing" as const),
        serverNote:
          loaded.reason === "expired"
            ? "Secret exists but is expired. The server would refuse to use it."
            : "No secret configured for this name in the selected scope.",
      };
    }

    return {
      name: args.name,
      resolution: "active" as const,
      serverNote:
        "Decrypted on the server, masked before returning to the browser.",
      maskedValue: maskSecret(loaded.value),
      updatedAt: loaded.updatedAt,
      expiresAt: loaded.expiresAt,
    };
  },
});

// ---------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Settings: rotation, cleanup, seed
// ---------------------------------------------------------------------------

export const getSettingsSnapshot = query({
  args: {
    workspace: v.string(),
    environment: environmentValidator,
  },
  returns: {
    activeVersion: v.number(),
    configuredVersions: v.array(v.number()),
    totalSecrets: v.number(),
    expiredSecrets: v.number(),
    versionCounts: v.array(
      v.object({ keyVersion: v.number(), count: v.number() }),
    ),
  },
  handler: async (ctx, args) => {
    const rows: Array<{ keyVersion: number; effectiveState: string }> = [];
    let cursor: string | null = null;
    while (true) {
      const result = await secrets.list(ctx, {
        namespace: toNamespace(args.workspace, args.environment),
        paginationOpts: { numItems: 100, cursor },
      });
      rows.push(...result.page);
      if (result.isDone) break;
      cursor = result.continueCursor;
    }

    const versionCounts = new Map<number, number>();
    let expiredSecrets = 0;
    for (const row of rows) {
      versionCounts.set(
        row.keyVersion,
        (versionCounts.get(row.keyVersion) ?? 0) + 1,
      );
      if (row.effectiveState === "expired") expiredSecrets += 1;
    }

    return {
      activeVersion: DEMO_KEYS[0].version,
      configuredVersions: DEMO_KEYS.map((k) => k.version),
      totalSecrets: rows.length,
      expiredSecrets,
      versionCounts: Array.from(versionCounts.entries()).map(
        ([keyVersion, count]) => ({ keyVersion, count }),
      ),
    };
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
    continueCursor: v.union(v.string(), v.null()),
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

export const seedLegacySecret = mutation({
  args: {
    workspace: v.string(),
    environment: environmentValidator,
    name: v.string(),
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
      name: args.name,
      value: args.value,
    });
  },
});

export const seedDemoData = mutation({
  args: {
    workspace: v.string(),
    environment: environmentValidator,
  },
  returns: { seeded: v.number() },
  handler: async (ctx, args) => {
    const namespace = toNamespace(args.workspace, args.environment);
    const demoSecrets = [
      { name: "DATABASE_URL", value: "postgresql://user:pass@db.example.com:5432/myapp" },
      { name: "OPENAI_API_KEY", value: "sk-proj-abc123def456ghi789" },
      { name: "STRIPE_SECRET_KEY", value: "sk_live_51abc123DEF456" },
      { name: "RESEND_API_KEY", value: "re_abc123_def456ghi789" },
      { name: "SLACK_WEBHOOK_SECRET", value: "whsec_abc123def456ghi789jkl" },
    ];

    let seeded = 0;
    for (const demo of demoSecrets) {
      const exists = await secrets.has(ctx, { namespace, name: demo.name });
      if (!exists) {
        await secrets.put(ctx, {
          namespace,
          name: demo.name,
          value: demo.value,
        });
        seeded += 1;
      }
    }

    // Seed one legacy-version secret for rotation demos
    const legacyName = "JWT_SIGNING_KEY";
    const legacyExists = await secrets.has(ctx, {
      namespace,
      name: legacyName,
    });
    if (!legacyExists) {
      await legacySecrets.put(ctx, {
        namespace,
        name: legacyName,
        value: "eyJhbGciOiJIUzI1NiJ9.legacy-demo-key",
      });
      seeded += 1;
    }

    return { seeded };
  },
});
