import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { resolveExpiresAt } from "./expiry.js";
import { api, internal } from "./_generated/api.js";
import { initConvexTest } from "./setup.test.js";
import { defineKeys } from "../keys-format.js";
import { resetKeyConfig } from "./keys.js";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  resetKeyConfig();
  process.env.SECRET_STORE_KEYS = defineKeys({
    1: Buffer.alloc(32, 1).toString("base64"),
  });
});

afterEach(() => {
  resetKeyConfig();
  delete process.env.SECRET_STORE_KEYS;
  vi.useRealTimers();
});

describe("scheduled expiry", () => {
  test("put flips the stored secret at expiresAt without changing its audit history", async () => {
    const t = initConvexTest();
    const { secretId, expiresAt, updatedAt } = await t.mutation(api.lib.put, {
      name: "short-lived",
      value: "v",
      ttlMs: 1000,
    });
    const row = () => t.run((ctx) => ctx.db.get("secrets", secretId));
    const events = await t.query(api.lib.listEvents, {
      secretId,
      paginationOpts: { numItems: 10, cursor: null },
    });

    vi.advanceTimersByTime(999);
    await t.finishInProgressScheduledFunctions();
    expect((await row())?.expiredAt).toBeUndefined();
    vi.advanceTimersByTime(1);
    await t.finishInProgressScheduledFunctions();
    expect(await row()).toMatchObject({ expiredAt: expiresAt, updatedAt });
    expect(
      await t.query(api.lib.listEvents, {
        secretId,
        paginationOpts: { numItems: 10, cursor: null },
      }),
    ).toEqual(events);
  });

  test("expire records its run time once even when invoked again", async () => {
    const t = initConvexTest();
    const { secretId, expiresAt } = await t.mutation(api.lib.put, {
      name: "delayed",
      value: "v",
      ttlMs: 1000,
    });
    vi.setSystemTime(Date.now() + 2000);
    const ranAt = Date.now();
    expect(
      await t.mutation(internal.expiry.expire, {
        secretId,
        expiresAt: expiresAt!,
      }),
    ).toBeNull();
    vi.setSystemTime(Date.now() + 1000);
    await t.mutation(internal.expiry.expire, {
      secretId,
      expiresAt: expiresAt!,
    });
    expect(
      (await t.run((ctx) => ctx.db.get("secrets", secretId)))?.expiredAt,
    ).toBe(ranAt);
  });

  test.each(["put", "update"] as const)(
    "%s with a new ttl ignores the old job and flips at the new expiry",
    async (operation) => {
      const t = initConvexTest();
      const { secretId, expiresAt } = await t.mutation(api.lib.put, {
        name: "renewed",
        value: "v",
        ttlMs: 1000,
      });
      vi.advanceTimersByTime(500);
      const nextExpiry = Date.parse("2026-01-01T00:00:02.500Z");
      const renewed =
        operation === "put"
          ? await t.mutation(api.lib.put, {
              name: "renewed",
              value: "new",
              ttlMs: 2000,
            })
          : await t.mutation(api.lib.update, { name: "renewed", ttlMs: 2000 });
      expect(renewed).toMatchObject({ expiresAt: nextExpiry });
      vi.advanceTimersByTime(500);
      await t.finishInProgressScheduledFunctions();
      expect(
        await t.mutation(internal.expiry.expire, {
          secretId,
          expiresAt: expiresAt!,
        }),
      ).toBeNull();
      expect(
        (await t.run((ctx) => ctx.db.get("secrets", secretId)))?.expiredAt,
      ).toBeUndefined();
      vi.advanceTimersByTime(1500);
      await t.finishInProgressScheduledFunctions();
      expect(
        (await t.run((ctx) => ctx.db.get("secrets", secretId)))?.expiredAt,
      ).toBe(nextExpiry);
    },
  );

  test.each(["overwrite", "remove ttl", "delete"] as const)(
    "a stale job is harmless after %s",
    async (operation) => {
      const t = initConvexTest();
      const { secretId, expiresAt } = await t.mutation(api.lib.put, {
        name: "changed",
        value: "v",
        ttlMs: 1000,
      });
      if (operation === "overwrite") {
        await t.mutation(api.lib.put, { name: "changed", value: "new" });
      } else if (operation === "remove ttl") {
        await t.mutation(api.lib.update, { name: "changed", ttlMs: null });
      } else {
        await t.mutation(api.lib.remove, { name: "changed" });
      }
      const before = await t.run((ctx) => ctx.db.get("secrets", secretId));
      await t.finishAllScheduledFunctions(vi.runAllTimers);
      expect(
        await t.mutation(internal.expiry.expire, {
          secretId,
          expiresAt: expiresAt!,
        }),
      ).toBeNull();
      expect(await t.run((ctx) => ctx.db.get("secrets", secretId))).toEqual(
        before,
      );
      expect(
        await t.query(api.lib.get, { name: "changed", now: Date.now() }),
      ).toMatchObject(
        operation === "delete"
          ? { ok: false, reason: "not_found" }
          : { ok: true, value: operation === "overwrite" ? "new" : "v" },
      );
    },
  );

  test("metadata-only updates preserve the expiry job", async () => {
    const t = initConvexTest();
    const { secretId, expiresAt } = await t.mutation(api.lib.put, {
      name: "metadata",
      value: "v",
      ttlMs: 1000,
    });
    await t.mutation(api.lib.update, {
      name: "metadata",
      metadata: { owner: "me" },
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await t.run((ctx) => ctx.db.get("secrets", secretId))).toMatchObject(
      { expiredAt: expiresAt, metadata: { owner: "me" } },
    );
  });

  test.each([undefined, 0, Number.MAX_SAFE_INTEGER])(
    "get and list use the clock before the job runs and ignore now=%s",
    async (now) => {
      const t = initConvexTest();
      const { secretId, expiresAt } = await t.mutation(api.lib.put, {
        name: "clock",
        value: "v",
        ttlMs: 1000,
      });
      const get = () => t.query(api.lib.get, { name: "clock", now });
      const list = () =>
        t.query(api.lib.list, {
          paginationOpts: { numItems: 10, cursor: null },
          now,
        });
      expect(await get()).toMatchObject({ ok: true, value: "v" });
      expect((await list()).page[0].effectiveState).toBe("active");
      vi.setSystemTime(expiresAt!);
      expect(
        (await t.run((ctx) => ctx.db.get("secrets", secretId)))?.expiredAt,
      ).toBeUndefined();
      expect(await get()).toEqual({ ok: false, reason: "expired" });
      expect((await list()).page[0].effectiveState).toBe("expired");
    },
  );

  test("get and list honor an expiredAt flag even when the clock precedes expiresAt", async () => {
    const t = initConvexTest();
    const { secretId } = await t.mutation(api.lib.put, {
      name: "flagged",
      value: "v",
      ttlMs: 1000,
    });
    await t.run((ctx) => ctx.db.patch("secrets", secretId, { expiredAt: 0 }));
    expect(
      await t.query(api.lib.get, { name: "flagged", now: Date.now() }),
    ).toEqual({ ok: false, reason: "expired" });
    const result = await t.query(api.lib.list, {
      paginationOpts: { numItems: 10, cursor: null },
      now: Date.now(),
    });
    expect(result.page[0].effectiveState).toBe("expired");
  });
});

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
