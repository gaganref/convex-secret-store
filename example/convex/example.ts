import { paginationOptsValidator } from "convex/server";
import { mutation, query } from "./_generated/server.js";
import { components } from "./_generated/api.js";
import { v } from "convex/values";
import { SecretStore } from "@gaganref/convex-secret-store";

const DEMO_KEY_V1 = "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=";

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

const secrets = new SecretStore<{
  namespace: Namespace;
  metadata: {
    provider:
      | "openai"
      | "anthropic"
      | "resend"
      | "stripe"
      | "slack"
      | "github";
    label?: string;
    owner?: string;
    notes?: string;
  };
}>(components.secretStore, {
  keys: [{ version: 1, value: DEMO_KEY_V1 }],
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
