import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { api } from "./_generated/api.js";
import { initConvexTest } from "./setup.test.js";
import { defineKeys } from "../keys-format.js";
import { resetKeyConfig } from "./keys.js";

const RAW_V1 = Buffer.alloc(32, 1).toString("base64");

beforeEach(() => {
  resetKeyConfig();
  process.env.SECRET_STORE_KEYS = defineKeys([{ version: 1, value: RAW_V1 }]);
});

afterEach(() => {
  resetKeyConfig();
  delete process.env.SECRET_STORE_KEYS;
});

describe("component lib — put and get", () => {
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
    });
    expect(result).toMatchObject({
      ok: true,
      value: "sk-secret",
      metadata: { provider: "openai" },
    });
  });

  test("get returns not_found for a missing secret", async () => {
    const t = initConvexTest();
    const result = await t.query(api.lib.get, { name: "missing" });
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

    const result = await t.query(api.lib.get, { name: "stripe" });
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
    const result = await t.query(api.lib.get, { name: "resend" });
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
    const result = await t.query(api.lib.get, { name: "legacy" });
    expect(result).toEqual({ ok: false, reason: "key_unavailable" });
  });

  test("put rejects an empty namespace", async () => {
    const t = initConvexTest();
    await expect(
      t.mutation(api.lib.put, { namespace: "", name: "x", value: "v" }),
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
});
