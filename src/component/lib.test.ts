import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ConvexError } from "convex/values";
import type { FunctionReturnType } from "convex/server";
import { api } from "./_generated/api.js";
import { initConvexTest } from "./setup.test.js";
import { defineKeys } from "../keys-format.js";
import { resetKeyConfig } from "./keys.js";

const RAW_V1 = Buffer.alloc(32, 1).toString("base64");
const RAW_V2 = Buffer.alloc(32, 2).toString("base64");
const KEYS = defineKeys({ 1: RAW_V1 });

// Captured with convex-helpers 0.1.134 on the indexes used by 0.2.1.
const legacyCursors = {
  by_namespace:
    '["workspace",1794376016189.003,"00000000000000010003secretEvents"]',
  by_namespace_and_name:
    '["workspace","one",1794376016189.003,"00000000000000010003secretEvents"]',
  by_namespace_and_type:
    '["workspace","created",1794376016189.003,"00000000000000010003secretEvents"]',
  by_namespace_and_updated_at:
    '["workspace",1235,1794376016189.002,"0000000000000000000010002secrets"]',
  by_secret_id:
    '["0000000000000000000010000secrets",1794376016189.003,"00000000000000010003secretEvents"]',
};

async function expectOnlyMatchingRows<Row>(
  pending: Promise<{ page: Row[] }>,
  matches: (row: Row) => boolean,
) {
  const outcome = await pending.then(
    (result) => ({ result }),
    (error: unknown) => ({ error }),
  );
  if ("error" in outcome) {
    expect(outcome.error).toMatchObject({
      data: { code: "invalid_argument" },
    });
  } else {
    expect(outcome.result.page.every(matches)).toBe(true);
  }
}

describe("pagination filter isolation", () => {
  test("list never returns rows outside the namespace for a foreign cursor", async () => {
    const t = initConvexTest();
    await t.mutation(api.lib.put, {
      namespace: "a-victim",
      name: "private-name",
      value: "v",
    });
    await t.mutation(api.lib.put, {
      namespace: "z-attacker",
      name: "public-name",
      value: "v",
    });

    await expectOnlyMatchingRows(
      t.query(api.lib.list, {
        namespace: "z-attacker",
        paginationOpts: {
          numItems: 10,
          cursor: JSON.stringify([
            "a-victim",
            Number.MAX_VALUE,
            Number.MAX_VALUE,
            "foreign-id",
          ]),
        },
        now: Date.now(),
      }),
      (row) => row.namespace === "z-attacker",
    );

    const expectedIds = [];
    for (let i = 0; i < 5; i++) {
      const { secretId } = await t.mutation(api.lib.put, {
        namespace: "workspace",
        name: `secret-${i}`,
        value: "v",
      });
      expectedIds.push(secretId);
    }
    await t.mutation(api.lib.put, {
      namespace: "other",
      name: "other",
      value: "v",
    });

    let cursor: string | null = null;
    const ids = [];
    for (let page = 0; page < 3; page++) {
      const result: FunctionReturnType<typeof api.lib.list> = await t.query(
        api.lib.list,
        {
          namespace: "workspace",
          now: Date.now(),
          paginationOpts: { numItems: 2, cursor },
        },
      );
      expect(result.page.every((row) => row.namespace === "workspace")).toBe(
        true,
      );
      ids.push(...result.page.map((row) => row.secretId));
      expect(result.isDone).toBe(page === 2);
      cursor = result.continueCursor;
    }
    expect(ids.sort()).toEqual(expectedIds.sort());
    expect(new Set(ids).size).toBe(5);
  });

  test.each(["namespace", "name", "type", "secretId"] as const)(
    "listEvents never returns rows outside the %s filter for a foreign cursor",
    async (filter) => {
      const t = initConvexTest();
      const victim = await t.mutation(api.lib.put, {
        namespace: "a-victim",
        name: "public-name",
        value: "v",
      });
      const { secretId } = await t.mutation(api.lib.put, {
        namespace: "z-attacker",
        name: "public-name",
        value: "v",
      });
      const filters =
        filter === "secretId"
          ? { secretId }
          : {
              namespace: "z-attacker",
              ...(filter === "name" ? { name: "z-public" } : {}),
              ...(filter === "type" ? { type: "updated" as const } : {}),
            };
      await expectOnlyMatchingRows(
        t.query(api.lib.listEvents, {
          ...filters,
          paginationOpts: {
            numItems: 10,
            cursor: JSON.stringify([
              filter === "secretId"
                ? victim.secretId
                : filter === "namespace"
                  ? "a-victim"
                  : "z-attacker",
              ...(filter === "name" ? ["public-name"] : []),
              ...(filter === "type" ? ["created"] : []),
              Number.MAX_VALUE,
              "foreign-id",
            ]),
          },
        }),
        (row) =>
          filter === "secretId"
            ? row.secretId === secretId
            : row.namespace === "z-attacker" &&
              (filter !== "name" || row.name === "z-public") &&
              (filter !== "type" || row.type === "updated"),
      );

      const { secretId: pagingSecretId } = await t.mutation(api.lib.put, {
        namespace: "workspace",
        name: "secret",
        value: "v",
      });
      for (let i = 0; i < 4; i++) {
        await t.mutation(api.lib.put, {
          namespace: "workspace",
          name: "secret",
          value: `v${i}`,
        });
      }
      await t.mutation(api.lib.put, {
        namespace: "other",
        name: "other",
        value: "v",
      });
      const pagingFilters =
        filter === "secretId"
          ? { secretId: pagingSecretId }
          : {
              namespace: "workspace",
              ...(filter === "name" ? { name: "secret" } : {}),
              ...(filter === "type" ? { type: "updated" as const } : {}),
            };
      if (filter === "type") {
        await t.mutation(api.lib.put, {
          namespace: "workspace",
          name: "secret",
          value: "last",
        });
      }

      let cursor: string | null = null;
      const ids = [];
      for (let page = 0; page < 3; page++) {
        const result: FunctionReturnType<typeof api.lib.listEvents> =
          await t.query(api.lib.listEvents, {
            ...pagingFilters,
            paginationOpts: { numItems: 2, cursor },
          });
        expect(result.page.every((row) => row.namespace === "workspace")).toBe(
          true,
        );
        if (filter === "type") {
          expect(result.page.every((row) => row.type === "updated")).toBe(true);
        }
        expect(
          result.page.every((row) => row.secretId === pagingSecretId),
        ).toBe(true);
        ids.push(...result.page.map((row) => row.eventId));
        expect(result.isDone).toBe(page === 2);
        cursor = result.continueCursor;
      }
      expect(ids).toHaveLength(5);
      expect(new Set(ids).size).toBe(5);
    },
  );
});

describe("native pagination", () => {
  test.each([false, true])(
    "reactive page boundaries return 65 secrets exactly once with overwrites=%s",
    async (overwrite) => {
      const t = initConvexTest();
      const names = Array.from({ length: 65 }, (_, i) => `secret-${i}`);
      for (const name of names) {
        await t.mutation(api.lib.put, {
          namespace: "workspace",
          name,
          value: "v",
        });
      }
      const args = { namespace: "workspace", now: Date.now() };
      const first = await t.query(api.lib.list, {
        ...args,
        paginationOpts: { numItems: 20, cursor: null },
      });
      for (const name of overwrite
        ? [...names.slice(0, 5), ...names.slice(-5)]
        : []) {
        await t.mutation(api.lib.put, {
          namespace: "workspace",
          name,
          value: "new",
        });
      }
      const refreshed = await t.query(api.lib.list, {
        ...args,
        paginationOpts: {
          numItems: 20,
          cursor: null,
          endCursor: first.continueCursor,
        },
      });
      const seen = refreshed.page.map((row) => row.name);
      let cursor = first.continueCursor;
      for (let page = 0; page < 10; page++) {
        const result = await t.query(api.lib.list, {
          ...args,
          paginationOpts: { numItems: 20, cursor },
        });
        seen.push(...result.page.map((row) => row.name));
        if (result.isDone) break;
        cursor = result.continueCursor;
      }
      expect(seen.sort()).toEqual(names.sort());
    },
  );

  test("list restarts a legacy cursor at page one", async () => {
    const t = initConvexTest();
    for (const name of ["one", "two", "three"]) {
      await t.mutation(api.lib.put, {
        namespace: "workspace",
        name,
        value: "v",
      });
    }
    const args = { namespace: "workspace", now: Date.now() };
    const first = await t.query(api.lib.list, {
      ...args,
      paginationOpts: { numItems: 2, cursor: null },
    });
    const restarted = await t.query(api.lib.list, {
      ...args,
      paginationOpts: {
        numItems: 2,
        cursor: legacyCursors.by_namespace_and_updated_at,
      },
    });
    expect(restarted).toEqual(first);
  });

  test("legacy page ranges restart at page one", async () => {
    const t = initConvexTest();
    await t.mutation(api.lib.put, { name: "one", value: "v" });
    const first = await t.query(api.lib.list, {
      now: 0,
      paginationOpts: { numItems: 2, cursor: null },
    });
    const restarted = await t.query(api.lib.list, {
      now: 0,
      paginationOpts: {
        numItems: 2,
        cursor: legacyCursors.by_namespace_and_updated_at,
        endCursor: legacyCursors.by_namespace_and_updated_at,
      },
    });
    expect(restarted).toEqual(first);
  });

  test("listEvents restarts legacy cursors for every filter", async () => {
    const t = initConvexTest();
    const { secretId } = await t.mutation(api.lib.put, {
      namespace: "workspace",
      name: "one",
      value: "v",
    });
    await t.mutation(api.lib.put, {
      namespace: "workspace",
      name: "one",
      value: "new",
    });
    for (const [filter, cursor] of [
      [{ namespace: "workspace" }, legacyCursors.by_namespace],
      [
        { namespace: "workspace", name: "one" },
        legacyCursors.by_namespace_and_name,
      ],
      [
        { namespace: "workspace", type: "updated" as const },
        legacyCursors.by_namespace_and_type,
      ],
      [{ secretId }, legacyCursors.by_secret_id],
    ] as const) {
      const first = await t.query(api.lib.listEvents, {
        ...filter,
        paginationOpts: { numItems: 1, cursor: null },
      });
      const restarted = await t.query(api.lib.listEvents, {
        ...filter,
        paginationOpts: { numItems: 1, cursor },
      });
      expect(restarted).toEqual(first);
    }
  });

  test("a native cursor resumes when only the end cursor is legacy", async () => {
    const t = initConvexTest();
    for (let i = 0; i < 5; i++) {
      await t.mutation(api.lib.put, {
        namespace: "workspace",
        name: `secret-${i}`,
        value: "v",
      });
    }
    const args = { namespace: "workspace", now: Date.now() };
    const first = await t.query(api.lib.list, {
      ...args,
      paginationOpts: { numItems: 2, cursor: null },
    });
    const options = { numItems: 2, cursor: first.continueCursor };
    const second = await t.query(api.lib.list, {
      ...args,
      paginationOpts: options,
    });
    const mixed = await t.query(api.lib.list, {
      ...args,
      paginationOpts: {
        ...options,
        endCursor: legacyCursors.by_namespace_and_updated_at,
      },
    });
    expect(mixed).toEqual(second);
    expect(mixed.page.map((row) => row.secretId)).not.toEqual(
      first.page.map((row) => row.secretId),
    );
  });

  test("list preserves native read-budget split fields", async () => {
    const t = initConvexTest();
    for (const name of ["one", "two", "three", "four"]) {
      await t.mutation(api.lib.put, { name, value: "v" });
    }
    const result = await t.query(api.lib.list, {
      now: Date.now(),
      paginationOpts: { numItems: 10, cursor: null, maximumRowsRead: 2 },
    });
    expect(result).toMatchObject({
      isDone: false,
      pageStatus: "SplitRequired",
      splitCursor: expect.any(String),
    });
    expect(result.page).toHaveLength(2);
  });

  test("listEvents preserves native read-budget split fields", async () => {
    const t = initConvexTest();
    for (const name of ["one", "two", "three", "four"]) {
      await t.mutation(api.lib.put, { name, value: "v" });
    }
    const result = await t.query(api.lib.listEvents, {
      paginationOpts: { numItems: 10, cursor: null, maximumRowsRead: 2 },
    });
    expect(result).toMatchObject({
      isDone: false,
      pageStatus: "SplitRequired",
      splitCursor: expect.any(String),
    });
    expect(result.page).toHaveLength(2);
  });
});

describe("key versions in use", () => {
  test("returns distinct versions across namespaces with one read per version plus one", async () => {
    const t = initConvexTest();
    for (let i = 0; i < 60; i++) {
      const { secretId } = await t.mutation(api.lib.put, {
        namespace: i % 2 ? "one" : "two",
        name: `secret-${i}`,
        value: "v",
      });
      await t.run(async (ctx) => {
        await ctx.db.patch("secrets", secretId, {
          keyVersion: [1, 7, 99][i % 3]!,
        });
      });
    }
    const reads = vi.fn();
    await t.run(async (ctx) => {
      const query = ctx.db.query("secrets").order("asc");
      const prototype = Object.getPrototypeOf(query) as typeof query;
      const first = prototype.first;
      vi.spyOn(prototype, "first").mockImplementation(function (
        this: typeof query,
      ) {
        reads();
        return first.call(this);
      });
    });
    expect(await t.query(api.lib.keyVersions, {})).toEqual([1, 7, 99]);
    expect(reads).toHaveBeenCalledTimes(4);
  });

  test("returns no key versions for an empty store", async () => {
    expect(await initConvexTest().query(api.lib.keyVersions, {})).toEqual([]);
  });

  test("bounds the query at 100 distinct key versions", async () => {
    const t = initConvexTest();
    for (let version = 1; version <= 101; version++) {
      const { secretId } = await t.mutation(api.lib.put, {
        name: `secret-${version}`,
        value: "v",
      });
      await t.run(async (ctx) => {
        await ctx.db.patch("secrets", secretId, { keyVersion: version });
      });
    }
    await expect(t.query(api.lib.keyVersions, {})).rejects.toMatchObject({
      data: {
        code: "invalid_argument",
        message: "store exceeds 100 distinct key versions",
      },
    });
  });
});

test("decryption errors do not disclose the secret name", async () => {
  const t = initConvexTest();
  const name = "private-provider-account";
  const { secretId } = await t.mutation(api.lib.put, {
    name,
    value: "private-value",
  });
  await t.run((ctx) =>
    ctx.db.patch("secrets", secretId, { encryptedValue: "invalid" }),
  );

  const error: unknown = await t
    .query(api.lib.get, { name, now: Date.now() })
    .catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(ConvexError);
  const data = (error as ConvexError<{ code: string; message: string }>).data;
  expect(data.code).toBe("decryption_failed");
  expect(data.message.includes(name)).toBe(false);
});

beforeEach(() => {
  resetKeyConfig();
  process.env.SECRET_STORE_KEYS = KEYS;
});

afterEach(() => {
  vi.restoreAllMocks();
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

  test("get throws decryption_failed when ciphertext has been tampered with", async () => {
    const t = initConvexTest();
    const created = await t.mutation(api.lib.put, { name: "k", value: "v" });

    // Corrupt the stored ciphertext byte-for-byte. The KEK is still valid,
    // version is still configured, expiry is fine — but AES-GCM's auth tag
    // check will fail on decrypt and `get` should surface that as a thrown
    // `decryption_failed`, not as a clean `{ ok: false }`.
    await t.run(async (ctx) => {
      const row = await ctx.db.get("secrets", created.secretId);
      if (row === null) throw new Error("row vanished");
      // Flip the first base64 character of the wrapped DEK.
      const flipped =
        (row.wrappedDEK[0] === "A" ? "B" : "A") + row.wrappedDEK.slice(1);
      await ctx.db.patch("secrets", created.secretId, { wrappedDEK: flipped });
    });

    await expect(
      t.query(api.lib.get, { name: "k", now: Date.now() }),
    ).rejects.toThrow(/decryption_failed|failed to decrypt/);
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

  test("update with neither metadata nor ttlMs throws invalid_argument", async () => {
    const t = initConvexTest();
    await t.mutation(api.lib.put, { name: "k", value: "v" });
    await expect(t.mutation(api.lib.update, { name: "k" })).rejects.toThrow(
      /at least one of metadata or ttlMs/,
    );
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

  test("update records an updated event with a changed-fields diff", async () => {
    const t = initConvexTest();
    await t.mutation(api.lib.put, { name: "k", value: "v" });

    await t.mutation(api.lib.update, { name: "k", metadata: { o: "x" } });
    await t.mutation(api.lib.update, { name: "k", ttlMs: 60_000 });
    await t.mutation(api.lib.update, {
      name: "k",
      metadata: { o: "y" },
      ttlMs: 120_000,
    });

    const events = await t.query(api.lib.listEvents, {
      paginationOpts: { numItems: 10, cursor: null },
      order: "asc",
    });
    expect(events.page.map((event) => event.type)).toEqual([
      "created",
      "updated",
      "updated",
      "updated",
    ]);
    expect(events.page[1]?.metadata).toEqual({ changed: ["metadata"] });
    expect(events.page[2]?.metadata).toEqual({ changed: ["ttl"] });
    expect(events.page[3]?.metadata).toEqual({
      changed: ["metadata", "ttl"],
    });
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
    expect(result).toEqual({ rotated: 0, skipped: 0, isDone: true, orphanVersions: [1] });

    // Row left untouched — still on its retired keyVersion.
    const row = await t.run((ctx) => ctx.db.get("secrets", created.secretId));
    expect(row?.keyVersion).toBe(1);
  });

  test("rotate skips rows when v1 material has been replaced (unsupported)", async () => {
    const t = initConvexTest();
    // Operator misconfiguration: replace the bytes under version 1 while a
    // row still references it (KEK material is contractually immutable; this
    // is the "material changed under the same version" scenario). The
    // hasVersion check passes (v1 is still configured) but rewrap fails
    // because the wrappedDEK was produced under the original bytes.
    resetKeyConfig();
    process.env.SECRET_STORE_KEYS = defineKeys({ 1: RAW_V1 });
    const created = await t.mutation(api.lib.put, { name: "k", value: "v" });

    resetKeyConfig();
    process.env.SECRET_STORE_KEYS = defineKeys({ 1: RAW_V2, 2: RAW_V1 });

    const result = await t.mutation(api.lib.rotate, {});
    expect(result).toEqual({ rotated: 0, skipped: 1, isDone: true });

    const row = await t.run((ctx) => ctx.db.get("secrets", created.secretId));
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

describe("rollback compatibility with 0.3.0 expiry flags", () => {
  async function flaggedSecret() {
    const t = initConvexTest();
    const { secretId } = await t.mutation(api.lib.put, {
      name: "flagged",
      value: "v1",
      ttlMs: 60_000,
    });
    await t.run((ctx) =>
      ctx.db.patch("secrets", secretId, { expiredAt: Date.now() }),
    );
    const expiredAt = async () =>
      (await t.run((ctx) => ctx.db.get("secrets", secretId)))?.expiredAt;
    return { t, expiredAt };
  }

  test("put over a flagged secret clears the flag", async () => {
    const { t, expiredAt } = await flaggedSecret();
    await t.mutation(api.lib.put, { name: "flagged", value: "v2" });
    expect(await expiredAt()).toBeUndefined();
  });

  test("update with a new ttl clears the flag", async () => {
    const { t, expiredAt } = await flaggedSecret();
    await t.mutation(api.lib.update, { name: "flagged", ttlMs: 60_000 });
    expect(await expiredAt()).toBeUndefined();
  });

  test("update of metadata alone keeps the flag", async () => {
    const { t, expiredAt } = await flaggedSecret();
    await t.mutation(api.lib.update, {
      name: "flagged",
      metadata: { owner: "x" },
    });
    expect(await expiredAt()).toBeTypeOf("number");
  });
});
