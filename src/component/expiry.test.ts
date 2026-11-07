import { describe, expect, test } from "vitest";
import { resolveExpiresAt } from "./expiry.js";
import { internal } from "./_generated/api.js";
import { initConvexTest } from "./setup.test.js";

describe("expiry rollback compatibility", () => {
  test("the schema accepts expiredAt left by a newer release", async () => {
    const t = initConvexTest();
    const id = await t.run((ctx) =>
      ctx.db.insert("secrets", {
        name: "from-newer-release",
        encryptedValue: "ciphertext",
        iv: "iv",
        wrappedDEK: "wrapped",
        dekIv: "dek-iv",
        keyVersion: 1,
        expiresAt: 10,
        expiredAt: 20,
        updatedAt: 0,
      }),
    );
    expect(await t.run((ctx) => ctx.db.get("secrets", id))).toMatchObject({
      name: "from-newer-release",
      expiresAt: 10,
      expiredAt: 20,
    });
  });

  test("the internal expire function returns null and changes no secrets or events", async () => {
    const t = initConvexTest();
    const secretId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("secrets", {
        name: "scheduled-secret",
        encryptedValue: "ciphertext",
        iv: "iv",
        wrappedDEK: "wrapped",
        dekIv: "dek-iv",
        keyVersion: 1,
        expiresAt: 10,
        updatedAt: 0,
      });
      await ctx.db.insert("secretEvents", {
        secretId: id,
        name: "scheduled-secret",
        type: "created",
      });
      return id;
    });
    const snapshot = () =>
      t.run(async (ctx) => ({
        secrets: await ctx.db.query("secrets").collect(),
        events: await ctx.db.query("secretEvents").collect(),
        scheduled: await ctx.db.system.query("_scheduled_functions").collect(),
      }));
    const before = await snapshot();
    expect(
      await t.mutation(internal.expiry.expire, { secretId, expiresAt: 10 }),
    ).toBeNull();
    expect(
      await t.mutation(internal.expiry.expire, { secretId, expiresAt: 999 }),
    ).toBeNull();
    expect(await snapshot()).toEqual(before);
  });
});

describe("resolveExpiresAt", () => {
  test("uses ttlMs when given a number", () => {
    expect(resolveExpiresAt(1000, 5000, null)).toBe(6000);
  });

  test("returns undefined when ttlMs is null", () => {
    expect(resolveExpiresAt(1000, null, 5000)).toBeUndefined();
  });

  test("falls back to the default when ttlMs is omitted", () => {
    expect(resolveExpiresAt(1000, undefined, 5000)).toBe(6000);
  });

  test("returns undefined when ttlMs is omitted and no default is set", () => {
    expect(resolveExpiresAt(1000, undefined, null)).toBeUndefined();
  });

  test("ttlMs overrides a configured default", () => {
    expect(resolveExpiresAt(1000, 200, 5000)).toBe(1200);
  });

  test("ttlMs null overrides a configured default", () => {
    expect(resolveExpiresAt(1000, null, 5000)).toBeUndefined();
  });

  test("rejects a negative ttlMs", () => {
    expect(() => resolveExpiresAt(1000, -1, null)).toThrow();
  });

  test("rejects a zero ttlMs", () => {
    expect(() => resolveExpiresAt(1000, 0, null)).toThrow();
  });

  test("rejects a zero default ttlMs when ttlMs is omitted", () => {
    expect(() => resolveExpiresAt(1000, undefined, 0)).toThrow();
  });

  test("rejects a non-integer ttlMs", () => {
    expect(() => resolveExpiresAt(1000, 1.5, null)).toThrow();
  });
});
