import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { resolveExpiresAt, scheduleExpiry } from "./expiry.js";
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
  delete process.env.SECRET_STORE_DEFAULT_TTL_MS;
  vi.useRealTimers();
});

describe("scheduled expiry", () => {
  test("1001 expiring puts leave 500 scheduling slots for the host", async (context) => {
    const t = initConvexTest();
    try {
      await t.run((ctx) => ctx.meta.getTransactionMetrics());
    } catch {
      context.skip(
        "This convex-test version does not implement transaction metrics",
      );
    }
    await t.run(async (ctx) => {
      for (let i = 0; i < 1001; i++) {
        await ctx.runMutation(api.lib.put, {
          name: `bulk-${i}`,
          value: "v",
          ttlMs: 3600000,
        });
      }
      expect(
        (await ctx.meta.getTransactionMetrics()).functionsScheduled,
      ).toEqual({
        used: 500,
        remaining: 500,
      });
    });
    expect(
      await t.query(api.lib.get, {
        name: "bulk-1000",
        now: Date.now() + 3600000,
      }),
    ).toEqual({ ok: false, reason: "expired" });
  });

  test.for(["put", "overwrite", "update"] as const)(
    "%s preserves the host reserve and resumes live expiry on a later rewrite",
    async (operation, context) => {
      const t = initConvexTest();
      try {
        await t.run((ctx) => ctx.meta.getTransactionMetrics());
      } catch {
        context.skip(
          "This convex-test version does not implement transaction metrics",
        );
      }
      const seed = await t.mutation(api.lib.put, { name: "seed", value: "v" });
      if (operation !== "put") {
        await t.mutation(api.lib.put, { name: "reserved", value: "v" });
      }
      await t.run(async (ctx) => {
        for (let i = 0; i < 500; i++) {
          await ctx.scheduler.runAt(
            Date.now() + 3600000,
            internal.expiry.expire,
            {
              secretId: seed.secretId,
              expiresAt: Date.now() + 3600000,
            },
          );
        }
        if (operation === "update") {
          await ctx.runMutation(api.lib.update, {
            name: "reserved",
            ttlMs: 1000,
          });
        } else {
          await ctx.runMutation(api.lib.put, {
            name: "reserved",
            value: "v",
            ttlMs: 1000,
          });
        }
        expect(
          (await ctx.meta.getTransactionMetrics()).functionsScheduled.remaining,
        ).toBe(500);
        for (let i = 0; i < 400; i++) {
          await ctx.scheduler.runAt(
            Date.now() + 3600000,
            internal.expiry.expire,
            {
              secretId: seed.secretId,
              expiresAt: Date.now() + 3600000,
            },
          );
        }
        await ctx.runMutation(api.lib.update, {
          name: "reserved",
          ttlMs: 1000,
        });
        expect(
          (await ctx.meta.getTransactionMetrics()).functionsScheduled.remaining,
        ).toBe(100);
      });
      vi.advanceTimersByTime(2000);
      await t.finishInProgressScheduledFunctions();
      expect(
        await t.query(api.lib.get, { name: "reserved", now: Date.now() }),
      ).toEqual({ ok: false, reason: "expired" });
      expect(
        (
          await t.query(api.lib.list, {
            paginationOpts: { numItems: 10, cursor: null },
            now: Date.now(),
          })
        ).page.find((secret) => secret.name === "reserved")?.effectiveState,
      ).toBe("expired");
      const { secretId } = await t.mutation(api.lib.put, {
        name: "reserved",
        value: "new",
        ttlMs: 1000,
      });
      vi.advanceTimersByTime(1000);
      await t.finishInProgressScheduledFunctions();
      expect(
        (await t.run((ctx) => ctx.db.get("secrets", secretId)))?.expiredAt,
      ).toBe(Date.now());
    },
  );

  test.each(["missing meta", "missing method", "throwing"] as const)(
    "expiry still schedules when transaction metrics are %s",
    async (environment) => {
      const t = initConvexTest();
      const { secretId } = await t.mutation(api.lib.put, {
        name: "fallback",
        value: "v",
      });
      const expiresAt = Date.now() + 1000;
      await t.run(async (ctx) => {
        await ctx.db.patch("secrets", secretId, { expiresAt });
        Object.defineProperty(ctx, "meta", {
          value:
            environment === "missing meta"
              ? undefined
              : environment === "missing method"
                ? {}
                : {
                    ...ctx.meta,
                    getTransactionMetrics: async () => {
                      throw new Error("unsupported metrics");
                    },
                  },
        });
        await scheduleExpiry(ctx, secretId, expiresAt, Date.now());
      });
      vi.advanceTimersByTime(1000);
      await t.finishInProgressScheduledFunctions();
      expect(
        (await t.run((ctx) => ctx.db.get("secrets", secretId)))?.expiredAt,
      ).toBe(expiresAt);
    },
  );

  test("scheduler failures still reject the expiring write", async () => {
    const t = initConvexTest();
    const { secretId } = await t.mutation(api.lib.put, {
      name: "failed",
      value: "v",
    });
    await expect(
      t.run(async (ctx) => {
        await ctx.db.patch("secrets", secretId, {
          expiresAt: Date.now() + 1000,
        });
        await scheduleExpiry(
          {
            ...ctx,
            meta: {
              ...ctx.meta,
              getTransactionMetrics: async () => {
                throw new Error("unsupported metrics");
              },
            },
            scheduler: {
              ...ctx.scheduler,
              runAt: async () => {
                throw new Error("scheduler failure");
              },
            },
          },
          secretId,
          Date.now() + 1000,
          Date.now(),
        );
      }),
    ).rejects.toThrow("scheduler failure");
    expect(
      (await t.run((ctx) => ctx.db.get("secrets", secretId)))?.expiresAt,
    ).toBeUndefined();
  });

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

  test("get and list use now for a legacy secret without an expiry job", async () => {
    const t = initConvexTest();
    const { secretId } = await t.mutation(api.lib.put, {
      name: "legacy",
      value: "v",
    });
    const expiresAt = Date.now() + 1000;
    await t.run((ctx) => ctx.db.patch("secrets", secretId, { expiresAt }));
    for (const now of [undefined, expiresAt - 1, expiresAt, expiresAt + 1]) {
      const expired = now !== undefined && now >= expiresAt;
      expect(await t.query(api.lib.get, { name: "legacy", now })).toMatchObject(
        expired ? { ok: false, reason: "expired" } : { ok: true, value: "v" },
      );
      const result = await t.query(api.lib.list, {
        paginationOpts: { numItems: 10, cursor: null },
        now,
      });
      expect(result.page[0].effectiveState).toBe(
        expired ? "expired" : "active",
      );
    }
    vi.setSystemTime(expiresAt + 1000);
    expect(await t.query(api.lib.get, { name: "legacy" })).toMatchObject({
      ok: true,
      value: "v",
    });
    const result = await t.query(api.lib.list, {
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(result.page[0].effectiveState).toBe("active");
  });

  test.each(["put", "overwrite", "update", "default"] as const)(
    "%s accepts far-future expiry without scheduling it and schedules nearer expiry",
    async (operation) => {
      const t = initConvexTest();
      const year = 365 * 24 * 60 * 60 * 1000;
      if (operation === "overwrite" || operation === "update") {
        await t.mutation(api.lib.put, { name: "horizon", value: "v" });
      }
      for (const years of [6, 1]) {
        const ttlMs = years * year;
        if (operation === "default") {
          process.env.SECRET_STORE_DEFAULT_TTL_MS = String(ttlMs);
          resetKeyConfig();
        }
        const result =
          operation === "update"
            ? await t.mutation(api.lib.update, { name: "horizon", ttlMs })
            : await t.mutation(api.lib.put, {
                name: "horizon",
                value: "v",
                ...(operation === "default" ? {} : { ttlMs }),
              });
        expect(result).toMatchObject({ expiresAt: expect.any(Number) });
        if (!("expiresAt" in result) || result.expiresAt === undefined) {
          throw new Error("write did not return an expiry");
        }
        expect(result.expiresAt).toBe(result.updatedAt! + ttlMs);
        const jobs = await t.run((ctx) =>
          ctx.db.system.query("_scheduled_functions").collect(),
        );
        expect(jobs).toHaveLength(years === 6 ? 0 : 1);
        if (years === 6) {
          expect(
            await t.query(api.lib.get, {
              name: "horizon",
              now: result.expiresAt,
            }),
          ).toEqual({ ok: false, reason: "expired" });
        }
      }
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
