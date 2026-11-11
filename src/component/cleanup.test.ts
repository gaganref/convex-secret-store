import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Id } from "./_generated/dataModel.js";
import { api } from "./_generated/api.js";
import { initConvexTest } from "./setup.test.js";
import { defineKeys } from "../keys-format.js";
import { resetKeyConfig } from "./keys.js";

const RAW_V1 = Buffer.alloc(32, 1).toString("base64");
const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
  resetKeyConfig();
  process.env.SECRET_STORE_KEYS = defineKeys({ 1: RAW_V1 });
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

  test("keeps retained secrets and their expiry flags unchanged without adding events", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const now = Date.now();
    const t = initConvexTest();
    const recent = await insertSecret(t, "recent", now - 1000);
    const atExpiry = await insertSecret(t, "at-expiry", now);
    const future = await insertSecret(t, "future", now + 1000);
    const permanent = await insertSecret(t, "permanent", undefined);
    const flagged = await insertSecret(t, "already-flagged", now - 2000);
    await t.run((ctx) =>
      ctx.db.patch("secrets", flagged, { expiredAt: now - 500 }),
    );
    const result = await t.mutation(api.cleanup.cleanupSecrets, {
      retentionMs: DAY,
    });
    expect(result).toEqual({ deleted: 0, isDone: true });
    const flags = await t.run(async (ctx) =>
      Promise.all(
        [recent, atExpiry, future, permanent, flagged].map(
          async (id) => (await ctx.db.get("secrets", id))?.expiredAt ?? null,
        ),
      ),
    );
    expect(flags).toEqual([null, null, null, null, now - 500]);
    expect(
      (
        await t.query(api.lib.listEvents, {
          paginationOpts: { numItems: 10, cursor: null },
        })
      ).page,
    ).toEqual([]);
  });

  test("leaves multiple batches of retained secrets unchanged without scheduling a sweep", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const now = Date.now();
    const t = initConvexTest();
    const ids: Id<"secrets">[] = [];
    for (let i = 0; i < 205; i++) {
      ids.push(await insertSecret(t, `legacy-${i}`, now - 1000 + i));
    }
    await t.run(async (ctx) => {
      for (const id of ids.slice(0, 100)) {
        await ctx.db.patch("secrets", id, { expiredAt: now - 500 });
      }
    });
    expect(
      await t.mutation(api.cleanup.cleanupSecrets, { retentionMs: DAY }),
    ).toEqual({ deleted: 0, isDone: true });
    expect(
      await t.run((ctx) =>
        ctx.db.system.query("_scheduled_functions").collect(),
      ),
    ).toEqual([]);
    const flags = await t.run(async (ctx) =>
      Promise.all(
        ids.map(
          async (id) => (await ctx.db.get("secrets", id))?.expiredAt ?? null,
        ),
      ),
    );
    expect(flags.slice(0, 100)).toEqual(Array<number>(100).fill(now - 500));
    expect(flags.slice(100)).toEqual(Array<null>(105).fill(null));
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

for (const table of ["secrets", "secretEvents"] as const) {
  test(`cleanup drains 100 large ${table} inside transaction limits`, async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2020-01-01T00:00:00.000Z"));
    const t = initConvexTest();
    for (let i = 0; i < 100; i++) {
      const { secretId } = await t.mutation(api.lib.put, {
        name: `large-${i}`,
        value: "v",
        metadata: { large: "x".repeat(256 * 1024) },
      });
      if (table === "secrets") {
        await t.mutation(api.lib.update, { name: `large-${i}`, ttlMs: 1 });
      } else {
        await t.run((ctx) =>
          ctx.db.insert("secretEvents", {
            secretId,
            name: `large-${i}`,
            type: "created",
            metadata: { large: "x".repeat(256 * 1024) },
          }),
        );
      }
    }
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    await t.mutation(
      table === "secrets"
        ? api.cleanup.cleanupSecrets
        : api.cleanup.cleanupEvents,
      { retentionMs: DAY },
    );
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const remaining =
      table === "secrets"
        ? await t.query(api.lib.list, {
            paginationOpts: { numItems: 1, cursor: null },
            now: Date.now(),
          })
        : await t.query(api.lib.listEvents, {
            paginationOpts: { numItems: 1, cursor: null },
          });
    expect(remaining.page).toEqual([]);
  });
}
