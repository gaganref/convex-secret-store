import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { api } from "./_generated/api.js";
import { initConvexTest } from "./setup.test.js";
import { defineKeys } from "../keys-format.js";
import { resetKeyConfig } from "./keys.js";

const RAW_V1 = Buffer.alloc(32, 1).toString("base64");
const RAW_V2 = Buffer.alloc(32, 2).toString("base64");
const KEYS = defineKeys({ 1: RAW_V1 });

beforeEach(() => {
  resetKeyConfig();
  process.env.SECRET_STORE_KEYS = KEYS;
});

afterEach(() => {
  resetKeyConfig();
  delete process.env.SECRET_STORE_KEYS;
  delete process.env.SECRET_STORE_DEFAULT_TTL_MS;
});

describe("component lib — put, get, has", () => {
  test("put then get round-trips an encrypted secret", async () => {
    const t = initConvexTest();
    const created = await t.mutation(api.lib.put, {
      namespace: "acme:production",
      name: "openai",
      value: "sk-secret",
      metadata: { provider: "openai" },
    });
    expect(created.isNew).toBe(true);

    const result = await t.query(api.lib.get, {
      namespace: "acme:production",
      name: "openai",
      now: Date.now(),
    });
    expect(result).toMatchObject({
      ok: true,
      value: "sk-secret",
      metadata: { provider: "openai" },
    });
  });

  test("get returns not_found for a missing secret", async () => {
    const t = initConvexTest();
    const result = await t.query(api.lib.get, {
      name: "missing",
      now: Date.now(),
    });
    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  test("put overwrites in place and preserves omitted metadata", async () => {
    const t = initConvexTest();
    await t.mutation(api.lib.put, {
      name: "stripe",
      value: "v1",
      metadata: { owner: "billing" },
    });
    const updated = await t.mutation(api.lib.put, {
      name: "stripe",
      value: "v2",
    });
    expect(updated.isNew).toBe(false);

    const result = await t.query(api.lib.get, {
      name: "stripe",
      now: Date.now(),
    });
    expect(result).toMatchObject({
      ok: true,
      value: "v2",
      metadata: { owner: "billing" },
    });
  });

  test("put clears metadata when passed null", async () => {
    const t = initConvexTest();
    await t.mutation(api.lib.put, {
      name: "resend",
      value: "v1",
      metadata: { owner: "platform" },
    });
    await t.mutation(api.lib.put, {
      name: "resend",
      value: "v2",
      metadata: null,
    });
    const result = await t.query(api.lib.get, {
      name: "resend",
      now: Date.now(),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.metadata).toBeUndefined();
    }
  });

  test("get returns key_unavailable when the row's key version is gone", async () => {
    const t = initConvexTest();
    await t.run(async (ctx) => {
      await ctx.db.insert("secrets", {
        name: "legacy",
        encryptedValue: "x",
        iv: "x",
        wrappedDEK: "x",
        dekIv: "x",
        keyVersion: 999,
        updatedAt: Date.now(),
      });
    });
    const result = await t.query(api.lib.get, {
      name: "legacy",
      now: Date.now(),
    });
    expect(result).toEqual({ ok: false, reason: "key_unavailable" });
  });

  test("put rejects an empty namespace", async () => {
    const t = initConvexTest();
    await expect(
      t.mutation(api.lib.put, { namespace: "", name: "x", value: "v" }),
    ).rejects.toThrow();
  });

  test("put rejects an empty name", async () => {
    const t = initConvexTest();
    await expect(
      t.mutation(api.lib.put, { name: "", value: "v" }),
    ).rejects.toThrow();
    await expect(
      t.mutation(api.lib.put, { name: "   ", value: "v" }),
    ).rejects.toThrow();
  });

  test("get rejects an empty name", async () => {
    const t = initConvexTest();
    await expect(
      t.query(api.lib.get, { name: "", now: Date.now() }),
    ).rejects.toThrow();
  });

  test("put rejects a value over the 64 KiB limit", async () => {
    const t = initConvexTest();
    await expect(
      t.mutation(api.lib.put, {
        name: "big",
        value: "x".repeat(64 * 1024 + 1),
      }),
    ).rejects.toThrow();
  });

  test("put with ttlMs records an absolute expiry", async () => {
    const t = initConvexTest();
    const created = await t.mutation(api.lib.put, {
      name: "temp",
      value: "v",
      ttlMs: 60_000,
    });
    expect(created.expiresAt).toBeTypeOf("number");

    const result = await t.query(api.lib.get, {
      name: "temp",
      now: Date.now(),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.expiresAt).toBe(created.expiresAt);
    }
  });

  test("get returns expired once now passes expiresAt", async () => {
    const t = initConvexTest();
    await t.mutation(api.lib.put, { name: "short", value: "v", ttlMs: 1_000 });
    const result = await t.query(api.lib.get, {
      name: "short",
      now: Date.now() + 10_000_000,
    });
    expect(result).toEqual({ ok: false, reason: "expired" });
  });

  test("ttlMs omitted uses the configured default TTL", async () => {
    process.env.SECRET_STORE_DEFAULT_TTL_MS = "60000";
    resetKeyConfig();
    const t = initConvexTest();
    const created = await t.mutation(api.lib.put, { name: "d", value: "v" });
    expect(created.expiresAt).toBeTypeOf("number");
  });

  test("ttlMs null stores no expiry even when a default is configured", async () => {
    process.env.SECRET_STORE_DEFAULT_TTL_MS = "60000";
    resetKeyConfig();
    const t = initConvexTest();
    const created = await t.mutation(api.lib.put, {
      name: "noexp",
      value: "v",
      ttlMs: null,
    });
    expect(created.expiresAt).toBeUndefined();
  });

  test("overwrite recomputes expiry — omitting ttlMs clears it", async () => {
    const t = initConvexTest();
    await t.mutation(api.lib.put, {
      name: "roll",
      value: "v1",
      ttlMs: 60_000,
    });
    const overwritten = await t.mutation(api.lib.put, {
      name: "roll",
      value: "v2",
    });
    expect(overwritten.expiresAt).toBeUndefined();
  });
});

describe("component lib — update and remove", () => {
  test("update changes metadata without touching the value", async () => {
    const t = initConvexTest();
    await t.mutation(api.lib.put, {
      name: "stripe",
      value: "sk_live",
      metadata: { owner: "billing" },
    });
    const result = await t.mutation(api.lib.update, {
      name: "stripe",
      metadata: { owner: "finance" },
    });
    expect(result.updated).toBe(true);

    const loaded = await t.query(api.lib.get, {
      name: "stripe",
      now: Date.now(),
    });
    expect(loaded).toMatchObject({
      ok: true,
      value: "sk_live",
      metadata: { owner: "finance" },
    });
  });

  test("update sets expiry from ttlMs", async () => {
    const t = initConvexTest();
    await t.mutation(api.lib.put, { name: "k", value: "v" });
    const result = await t.mutation(api.lib.update, {
      name: "k",
      ttlMs: 60_000,
    });
    expect(result.updated).toBe(true);
    if (result.updated) {
      expect(result.expiresAt).toBeTypeOf("number");
    }
  });

  test("update preserves the field it is not given", async () => {
    const t = initConvexTest();
    await t.mutation(api.lib.put, {
      name: "k",
      value: "v",
      metadata: { owner: "platform" },
      ttlMs: 60_000,
    });
    await t.mutation(api.lib.update, { name: "k", metadata: { owner: "ops" } });
    const loaded = await t.query(api.lib.get, { name: "k", now: Date.now() });
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      expect(loaded.metadata).toEqual({ owner: "ops" });
      expect(loaded.expiresAt).toBeTypeOf("number");
    }
  });

  test("update clears metadata and expiry with null", async () => {
    const t = initConvexTest();
    await t.mutation(api.lib.put, {
      name: "k",
      value: "v",
      metadata: { owner: "platform" },
      ttlMs: 60_000,
    });
    await t.mutation(api.lib.update, {
      name: "k",
      metadata: null,
      ttlMs: null,
    });
    const loaded = await t.query(api.lib.get, { name: "k", now: Date.now() });
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      expect(loaded.metadata).toBeUndefined();
      expect(loaded.expiresAt).toBeUndefined();
    }
  });

  test("update returns updated:false for a missing secret", async () => {
    const t = initConvexTest();
    const result = await t.mutation(api.lib.update, {
      name: "missing",
      metadata: { owner: "x" },
    });
    expect(result).toEqual({ updated: false });
  });

  test("update with nothing to change returns updated:false", async () => {
    const t = initConvexTest();
    await t.mutation(api.lib.put, { name: "k", value: "v" });
    const result = await t.mutation(api.lib.update, { name: "k" });
    expect(result).toEqual({ updated: false });
  });

  test("remove deletes a secret", async () => {
    const t = initConvexTest();
    await t.mutation(api.lib.put, { name: "k", value: "v" });
    const result = await t.mutation(api.lib.remove, { name: "k" });
    expect(result).toEqual({ removed: true });

    const loaded = await t.query(api.lib.get, { name: "k", now: Date.now() });
    expect(loaded).toEqual({ ok: false, reason: "not_found" });
  });

  test("remove returns removed:false for a missing secret", async () => {
    const t = initConvexTest();
    const result = await t.mutation(api.lib.remove, { name: "missing" });
    expect(result).toEqual({ removed: false });
  });
});

describe("component lib — audit events", () => {
  test("put records a created event", async () => {
    const t = initConvexTest();
    await t.mutation(api.lib.put, { name: "openai", value: "v" });
    const events = await t.query(api.lib.listEvents, {
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(events.page).toHaveLength(1);
    expect(events.page[0]).toMatchObject({ name: "openai", type: "created" });
  });

  test("overwriting records an updated event", async () => {
    const t = initConvexTest();
    await t.mutation(api.lib.put, { name: "k", value: "v1" });
    await t.mutation(api.lib.put, { name: "k", value: "v2" });
    const events = await t.query(api.lib.listEvents, {
      paginationOpts: { numItems: 10, cursor: null },
      order: "asc",
    });
    expect(events.page.map((event) => event.type)).toEqual([
      "created",
      "updated",
    ]);
  });

  test("update records an updated event", async () => {
    const t = initConvexTest();
    await t.mutation(api.lib.put, { name: "k", value: "v" });
    await t.mutation(api.lib.update, { name: "k", metadata: { o: "x" } });
    const events = await t.query(api.lib.listEvents, {
      paginationOpts: { numItems: 10, cursor: null },
      order: "asc",
    });
    expect(events.page.map((event) => event.type)).toEqual([
      "created",
      "updated",
    ]);
  });

  test("remove records a deleted event with a reason", async () => {
    const t = initConvexTest();
    const created = await t.mutation(api.lib.put, { name: "k", value: "v" });
    await t.mutation(api.lib.remove, { name: "k" });
    const events = await t.query(api.lib.listEvents, {
      secretId: created.secretId,
      paginationOpts: { numItems: 10, cursor: null },
      order: "asc",
    });
    expect(events.page.map((event) => event.type)).toEqual([
      "created",
      "deleted",
    ]);
    expect(events.page[1]?.metadata).toEqual({ reason: "removed" });
  });

  test("listEvents filters by namespace", async () => {
    const t = initConvexTest();
    await t.mutation(api.lib.put, {
      namespace: "a:prod",
      name: "k",
      value: "v",
    });
    await t.mutation(api.lib.put, {
      namespace: "b:prod",
      name: "k",
      value: "v",
    });
    const events = await t.query(api.lib.listEvents, {
      namespace: "a:prod",
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(events.page).toHaveLength(1);
    expect(events.page[0]?.namespace).toBe("a:prod");
  });

  test("listEvents filters by name", async () => {
    const t = initConvexTest();
    await t.mutation(api.lib.put, {
      namespace: "a:prod",
      name: "openai",
      value: "v",
    });
    await t.mutation(api.lib.put, {
      namespace: "a:prod",
      name: "stripe",
      value: "v",
    });
    const events = await t.query(api.lib.listEvents, {
      namespace: "a:prod",
      name: "openai",
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(events.page).toHaveLength(1);
    expect(events.page[0]?.name).toBe("openai");
  });

  test("listEvents filters by type", async () => {
    const t = initConvexTest();
    await t.mutation(api.lib.put, {
      namespace: "a:prod",
      name: "k",
      value: "v1",
    });
    await t.mutation(api.lib.put, {
      namespace: "a:prod",
      name: "k",
      value: "v2",
    });
    const events = await t.query(api.lib.listEvents, {
      namespace: "a:prod",
      type: "updated",
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(events.page).toHaveLength(1);
    expect(events.page[0]?.type).toBe("updated");
  });

  test("listEvents rejects combining name and type", async () => {
    const t = initConvexTest();
    await expect(
      t.query(api.lib.listEvents, {
        namespace: "a:prod",
        name: "k",
        type: "created",
        paginationOpts: { numItems: 10, cursor: null },
      }),
    ).rejects.toThrow();
  });

  test("listEvents rejects combining secretId with namespace", async () => {
    const t = initConvexTest();
    const created = await t.mutation(api.lib.put, { name: "k", value: "v" });
    await expect(
      t.query(api.lib.listEvents, {
        secretId: created.secretId,
        namespace: "a:prod",
        paginationOpts: { numItems: 10, cursor: null },
      }),
    ).rejects.toThrow();
  });

  test("listEvents filters by name in the default namespace (no namespace arg)", async () => {
    const t = initConvexTest();
    await t.mutation(api.lib.put, { name: "openai", value: "v" });
    await t.mutation(api.lib.put, { name: "stripe", value: "v" });
    const events = await t.query(api.lib.listEvents, {
      name: "openai",
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(events.page).toHaveLength(1);
    expect(events.page[0]?.name).toBe("openai");
    expect(events.page[0]?.namespace).toBeUndefined();
  });

  test("listEvents filters by type in the default namespace (no namespace arg)", async () => {
    const t = initConvexTest();
    await t.mutation(api.lib.put, { name: "k", value: "v1" });
    await t.mutation(api.lib.put, { name: "k", value: "v2" });
    const events = await t.query(api.lib.listEvents, {
      type: "updated",
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(events.page).toHaveLength(1);
    expect(events.page[0]?.type).toBe("updated");
    expect(events.page[0]?.namespace).toBeUndefined();
  });
});

describe("component lib — list", () => {
  test("list returns secrets in a namespace", async () => {
    const t = initConvexTest();
    await t.mutation(api.lib.put, {
      namespace: "a:prod",
      name: "one",
      value: "v",
    });
    await t.mutation(api.lib.put, {
      namespace: "a:prod",
      name: "two",
      value: "v",
    });
    const result = await t.query(api.lib.list, {
      namespace: "a:prod",
      paginationOpts: { numItems: 10, cursor: null },
      now: Date.now(),
    });
    expect(result.page.map((secret) => secret.name).sort()).toEqual([
      "one",
      "two",
    ]);
  });

  test("list orders by most-recently-updated first", async () => {
    const t = initConvexTest();
    await t.mutation(api.lib.put, {
      namespace: "a:prod",
      name: "first",
      value: "v",
    });
    await t.mutation(api.lib.put, {
      namespace: "a:prod",
      name: "second",
      value: "v",
    });
    const result = await t.query(api.lib.list, {
      namespace: "a:prod",
      paginationOpts: { numItems: 10, cursor: null },
      now: Date.now(),
    });
    expect(result.page[0]?.name).toBe("second");
  });

  test("list reports effectiveState per row", async () => {
    const t = initConvexTest();
    await t.mutation(api.lib.put, {
      namespace: "a:prod",
      name: "perm",
      value: "v",
    });
    await t.mutation(api.lib.put, {
      namespace: "a:prod",
      name: "temp",
      value: "v",
      ttlMs: 1_000,
    });
    const result = await t.query(api.lib.list, {
      namespace: "a:prod",
      paginationOpts: { numItems: 10, cursor: null },
      now: Date.now() + 10_000_000,
    });
    const states = Object.fromEntries(
      result.page.map((secret) => [secret.name, secret.effectiveState]),
    );
    expect(states).toEqual({ perm: "active", temp: "expired" });
  });

  test("list is scoped to its namespace", async () => {
    const t = initConvexTest();
    await t.mutation(api.lib.put, {
      namespace: "a:prod",
      name: "k",
      value: "v",
    });
    await t.mutation(api.lib.put, {
      namespace: "b:prod",
      name: "k",
      value: "v",
    });
    const result = await t.query(api.lib.list, {
      namespace: "a:prod",
      paginationOpts: { numItems: 10, cursor: null },
      now: Date.now(),
    });
    expect(result.page).toHaveLength(1);
    expect(result.page[0]?.namespace).toBe("a:prod");
  });

  test("list rejects an empty namespace", async () => {
    const t = initConvexTest();
    await expect(
      t.query(api.lib.list, {
        namespace: "",
        paginationOpts: { numItems: 10, cursor: null },
        now: Date.now(),
      }),
    ).rejects.toThrow();
  });
});

describe("component lib — rotation", () => {
  test("rotate rewraps a stale secret onto the active version", async () => {
    const t = initConvexTest();
    // Stage 1 — only v1 configured; the secret is wrapped under v1.
    resetKeyConfig();
    process.env.SECRET_STORE_KEYS = defineKeys({ 1: RAW_V1 });
    await t.mutation(api.lib.put, { name: "k", value: "secret-value" });

    // Stage 2 — add v2 (now active); the v1 row is stale.
    resetKeyConfig();
    process.env.SECRET_STORE_KEYS = defineKeys({
      1: RAW_V1,
      2: RAW_V2,
    });

    expect(await t.query(api.lib.isRotationComplete, {})).toBe(false);
    const result = await t.mutation(api.lib.rotate, {});
    expect(result).toEqual({ rotated: 1, skipped: 0, isDone: true });
    expect(await t.query(api.lib.isRotationComplete, {})).toBe(true);

    const loaded = await t.query(api.lib.get, { name: "k", now: Date.now() });
    expect(loaded).toMatchObject({ ok: true, value: "secret-value" });
  });

  test("rotate records a rotated audit event", async () => {
    const t = initConvexTest();
    resetKeyConfig();
    process.env.SECRET_STORE_KEYS = defineKeys({ 1: RAW_V1 });
    const created = await t.mutation(api.lib.put, { name: "k", value: "v" });

    resetKeyConfig();
    process.env.SECRET_STORE_KEYS = defineKeys({
      1: RAW_V1,
      2: RAW_V2,
    });
    await t.mutation(api.lib.rotate, {});

    const events = await t.query(api.lib.listEvents, {
      secretId: created.secretId,
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(events.page.map((event) => event.type)).toContain("rotated");
  });

  test("rotate is a no-op when every secret is on the active version", async () => {
    const t = initConvexTest();
    await t.mutation(api.lib.put, { name: "k", value: "v" });
    const result = await t.mutation(api.lib.rotate, {});
    expect(result).toEqual({ rotated: 0, skipped: 0, isDone: true });
  });

  test("rotate skips orphan rows whose keyVersion has been retired", async () => {
    const t = initConvexTest();
    // Start at v1, write a secret, then move active to v2 and retire v1
    // entirely. The row's `keyVersion` (1) is now not configured anywhere.
    resetKeyConfig();
    process.env.SECRET_STORE_KEYS = defineKeys({ 1: RAW_V1 });
    const created = await t.mutation(api.lib.put, { name: "k", value: "v" });

    resetKeyConfig();
    process.env.SECRET_STORE_KEYS = defineKeys({ 2: RAW_V2 });

    const result = await t.mutation(api.lib.rotate, {});
    expect(result).toEqual({ rotated: 0, skipped: 1, isDone: true });

    // Row left untouched — still on its retired keyVersion.
    const row = await t.run((ctx) => ctx.db.get(created.secretId));
    expect(row?.keyVersion).toBe(1);
  });

  test("isRotationComplete is true for an empty store", async () => {
    const t = initConvexTest();
    expect(await t.query(api.lib.isRotationComplete, {})).toBe(true);
  });

  test("isRotationComplete returns false when a row sits above the active version", async () => {
    const t = initConvexTest();
    // beforeEach configures active = 1. Insert a row at version 99 — a row
    // that could arise if an operator retired the highest configured key.
    await t.run(async (ctx) => {
      await ctx.db.insert("secrets", {
        name: "future",
        encryptedValue: "x",
        iv: "x",
        wrappedDEK: "x",
        dekIv: "x",
        keyVersion: 99,
        updatedAt: Date.now(),
      });
    });
    expect(await t.query(api.lib.isRotationComplete, {})).toBe(false);
  });
});
