import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api.js";
import { initConvexTest } from "./setup.test.js";
import { defineKeys } from "../keys-format.js";
import { resetKeyConfig } from "./keys.js";

const RAW_V1 = Buffer.alloc(32, 1).toString("base64");
const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
  resetKeyConfig();
  process.env.SECRET_STORE_KEYS = defineKeys([{ version: 1, value: RAW_V1 }]);
});

afterEach(() => {
  resetKeyConfig();
  delete process.env.SECRET_STORE_KEYS;
  vi.useRealTimers();
});

async function insertSecret(
  t: ReturnType<typeof initConvexTest>,
  name: string,
  expiresAt: number | undefined,
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("secrets", {
      name,
      encryptedValue: "x",
      iv: "x",
      wrappedDEK: "x",
      dekIv: "x",
      keyVersion: 1,
      ...(expiresAt !== undefined ? { expiresAt } : {}),
      updatedAt: Date.now(),
    });
  });
}

describe("component cleanup — secrets", () => {
  test("deletes a secret expired past the retention window", async () => {
    const t = initConvexTest();
    const id = await insertSecret(t, "old", Date.now() - 100 * DAY);

    const result = await t.mutation(api.cleanup.cleanupSecrets, {
      retentionMs: 30 * DAY,
    });
    expect(result).toEqual({ deleted: 1, isDone: true });

    const events = await t.query(api.lib.listEvents, {
      secretId: id,
      paginationOpts: { numItems: 10, cursor: null },
    });
    const cleanupEvent = events.page.find((event) => event.type === "deleted");
    expect(cleanupEvent?.metadata).toEqual({ reason: "expired_cleanup" });
  });

  test("keeps a secret still within the retention window", async () => {
    const t = initConvexTest();
    await insertSecret(t, "recent", Date.now() - 1000);
    const result = await t.mutation(api.cleanup.cleanupSecrets, {
      retentionMs: 30 * DAY,
    });
    expect(result.deleted).toBe(0);
  });

  test("never deletes a secret with no expiry", async () => {
    const t = initConvexTest();
    await insertSecret(t, "perm", undefined);
    const result = await t.mutation(api.cleanup.cleanupSecrets, {
      retentionMs: 1,
    });
    expect(result.deleted).toBe(0);
  });

  test("rejects a non-positive retentionMs", async () => {
    const t = initConvexTest();
    await expect(
      t.mutation(api.cleanup.cleanupSecrets, { retentionMs: 0 }),
    ).rejects.toThrow();
  });
});

describe("component cleanup — events", () => {
  test("deletes events older than the retention window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2020-01-01T00:00:00.000Z"));
    const t = initConvexTest();
    await t.mutation(api.lib.put, { name: "k", value: "v" });

    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const result = await t.mutation(api.cleanup.cleanupEvents, {
      retentionMs: 30 * DAY,
    });
    expect(result.deleted).toBe(1);
  });

  test("keeps recent events", async () => {
    const t = initConvexTest();
    await t.mutation(api.lib.put, { name: "k", value: "v" });
    const result = await t.mutation(api.cleanup.cleanupEvents, {
      retentionMs: 365 * DAY,
    });
    expect(result.deleted).toBe(0);
  });
});
