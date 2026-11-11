import {
  afterEach,
  beforeEach,
  describe,
  expect,
  expectTypeOf,
  test,
  vi,
} from "vitest";
import { ConvexError } from "convex/values";
import { SecretStore, isSecretStoreError } from "./index.js";
import { components, initConvexTest } from "./setup.test.js";
import { defineKeys } from "../keys-format.js";
import { resetKeyConfig } from "../component/keys.js";
import type {
  PaginationOptions as NativePaginationOptions,
  PaginationResult,
} from "convex/server";
import type {
  GetArgs,
  ListArgs,
  PaginationOptions,
  ListItem,
  ListResult,
  RunMutationCtx,
  RunQueryCtx,
} from "./types.js";

const RAW_V1 = Buffer.alloc(32, 1).toString("base64");
const RAW_V2 = Buffer.alloc(32, 2).toString("base64");

beforeEach(() => {
  resetKeyConfig();
  process.env.SECRET_STORE_KEYS = defineKeys({ 1: RAW_V1 });
});

afterEach(() => {
  resetKeyConfig();
  delete process.env.SECRET_STORE_KEYS;
});

function ctxFrom(t: ReturnType<typeof initConvexTest>) {
  const mutationCtx: RunMutationCtx = {
    // `any` bridges convex-test's rest-arg signature to the facade's ctx type.
    runMutation: (mutation: any, args: any) => t.mutation(mutation, args),
  };
  const queryCtx: RunQueryCtx = {
    runQuery: (query: any, args: any) => t.query(query, args),
  };
  return { mutationCtx, queryCtx };
}

describe("SecretStore facade", () => {
  test("isSecretStoreError requires a string message", () => {
    for (const message of [null, undefined, 1, false, {}, []]) {
      expect(
        isSecretStoreError(new ConvexError({ code: "not_found", message })),
      ).toBe(false);
    }
    for (const code of [
      "invalid_argument",
      "invalid_keys",
      "key_unavailable",
      "decryption_failed",
      "value_too_large",
      "not_found",
      "expired",
    ]) {
      expect(
        isSecretStoreError(new ConvexError({ code, message: "unavailable" })),
      ).toBe(true);
    }
    expect(
      isSecretStoreError(new ConvexError({ code: "not_found", message: "" })),
    ).toBe(true);
    expect(
      isSecretStoreError(
        new ConvexError({ code: "other", message: "unavailable" }),
      ),
    ).toBe(false);
    expect(isSecretStoreError(new Error("unavailable"))).toBe(false);
  });

  test.each(["put", "update"] as const)(
    "%s rejects Date metadata before the component call without disclosing plaintext",
    async (operation) => {
      const t = initConvexTest();
      const { mutationCtx, queryCtx } = ctxFrom(t);
      const secrets = new SecretStore(components.secretStore);
      const plaintext = "sensitive-value-never-log";
      await secrets.put(mutationCtx, {
        name: "api-key",
        value: plaintext,
        metadata: { owner: "platform" },
      });
      const typedSecrets = new SecretStore<string, { expires: Date }>(
        components.secretStore,
      );
      let componentCalls = 0;
      const observedCtx: RunMutationCtx = {
        runMutation: (ref, args) => {
          componentCalls++;
          return mutationCtx.runMutation(ref, args);
        },
      };
      const args = { name: "api-key", metadata: { expires: new Date(0) } };
      const error: unknown = await (
        operation === "put"
          ? typedSecrets.put(observedCtx, { ...args, value: plaintext })
          : typedSecrets.update(observedCtx, args)
      ).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(ConvexError);
      expect(isSecretStoreError(error)).toBe(true);
      const data = (error as ConvexError<{ code: string; message: string }>)
        .data;
      expect(data).toEqual({
        code: "invalid_argument",
        message: "metadata must contain only Convex values",
      });
      expect(String(error).includes(plaintext)).toBe(false);
      expect(JSON.stringify(data).includes(plaintext)).toBe(false);
      expect(componentCalls).toBe(0);
      expect(await secrets.get(queryCtx, { name: "api-key" })).toMatchObject({
        ok: true,
        value: plaintext,
        metadata: { owner: "platform" },
      });

      const write = (metadata?: Record<string, unknown> | null) =>
        operation === "put"
          ? secrets.put(mutationCtx, {
              name: "api-key",
              value: plaintext,
              metadata,
              ttlMs: null,
            })
          : secrets.update(mutationCtx, {
              name: "api-key",
              metadata,
              ttlMs: null,
            });
      await write();
      expect(await secrets.get(queryCtx, { name: "api-key" })).toMatchObject({
        ok: true,
        metadata: { owner: "platform" },
      });
      await write(null);
      const cleared = await secrets.getOrThrow(queryCtx, { name: "api-key" });
      expect(cleared.metadata).toBeUndefined();
      await write({ owner: undefined });
      expect(await secrets.get(queryCtx, { name: "api-key" })).toMatchObject({
        ok: true,
        metadata: {},
      });
      await write({ owner: "ops", nested: { enabled: true } });
      expect(await secrets.get(queryCtx, { name: "api-key" })).toMatchObject({
        ok: true,
        value: plaintext,
        metadata: { owner: "ops", nested: { enabled: true } },
      });
    },
  );

  test("put and get round-trip through the facade", async () => {
    const t = initConvexTest();
    const { mutationCtx, queryCtx } = ctxFrom(t);
    const secrets = new SecretStore<string, { provider: string }>(
      components.secretStore,
    );

    const created = await secrets.put(mutationCtx, {
      namespace: "acme:production",
      name: "openai",
      value: "sk-secret",
      metadata: { provider: "openai" },
    });
    expect(created.isNew).toBe(true);

    const result = await secrets.get(queryCtx, {
      namespace: "acme:production",
      name: "openai",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe("sk-secret");
      expect(result.metadata).toEqual({ provider: "openai" });
    }
  });

  test("get returns a discriminated not_found result", async () => {
    const t = initConvexTest();
    const { queryCtx } = ctxFrom(t);
    const secrets = new SecretStore(components.secretStore);

    const result = await secrets.get(queryCtx, { name: "missing" });
    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  test("getOrThrow returns the decrypted payload", async () => {
    const t = initConvexTest();
    const { mutationCtx, queryCtx } = ctxFrom(t);
    const secrets = new SecretStore(components.secretStore);

    await secrets.put(mutationCtx, { name: "openai", value: "sk-secret" });
    const success = await secrets.getOrThrow(queryCtx, { name: "openai" });
    expect(success.value).toBe("sk-secret");
  });

  test("getOrThrow throws a typed error when the secret is missing", async () => {
    const t = initConvexTest();
    const { queryCtx } = ctxFrom(t);
    const secrets = new SecretStore(components.secretStore);

    const error = await secrets
      .getOrThrow(queryCtx, { name: "missing" })
      .catch((caught: unknown) => caught);
    expect(isSecretStoreError(error)).toBe(true);
    if (isSecretStoreError(error)) {
      expect(error.data.code).toBe("not_found");
    }
  });

  test("get.ok reports presence through the facade", async () => {
    const t = initConvexTest();
    const { mutationCtx, queryCtx } = ctxFrom(t);
    const secrets = new SecretStore(components.secretStore);

    expect((await secrets.get(queryCtx, { name: "openai" })).ok).toBe(false);
    await secrets.put(mutationCtx, { name: "openai", value: "sk" });
    expect((await secrets.get(queryCtx, { name: "openai" })).ok).toBe(true);
  });

  test("isSecretStoreError narrows a secret-store ConvexError", async () => {
    const t = initConvexTest();
    const { mutationCtx } = ctxFrom(t);
    const secrets = new SecretStore(components.secretStore);

    const error = await secrets
      .put(mutationCtx, { namespace: "", name: "x", value: "v" })
      .catch((caught: unknown) => caught);

    expect(isSecretStoreError(error)).toBe(true);
    if (isSecretStoreError(error)) {
      expect(error.data.code).toBe("invalid_argument");
    }
  });

  test("update and remove work through the facade", async () => {
    const t = initConvexTest();
    const { mutationCtx, queryCtx } = ctxFrom(t);
    const secrets = new SecretStore<string, { owner: string }>(
      components.secretStore,
    );

    await secrets.put(mutationCtx, {
      name: "openai",
      value: "sk",
      metadata: { owner: "platform" },
    });
    const updated = await secrets.update(mutationCtx, {
      name: "openai",
      metadata: { owner: "ops" },
    });
    expect(updated.updated).toBe(true);

    const removed = await secrets.remove(mutationCtx, { name: "openai" });
    expect(removed).toEqual({ removed: true });
    expect((await secrets.get(queryCtx, { name: "openai" })).ok).toBe(false);
  });

  test("listEvents paginates audit events through the facade", async () => {
    const t = initConvexTest();
    const { mutationCtx, queryCtx } = ctxFrom(t);
    const secrets = new SecretStore(components.secretStore);

    await secrets.put(mutationCtx, { name: "openai", value: "sk" });
    const events = await secrets.listEvents(queryCtx, {
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(events.page).toHaveLength(1);
    expect(events.page[0]?.type).toBe("created");
  });

  test("list paginates secrets through the facade", async () => {
    const t = initConvexTest();
    const { mutationCtx, queryCtx } = ctxFrom(t);
    const secrets = new SecretStore(components.secretStore);

    await secrets.put(mutationCtx, {
      namespace: "a:prod",
      name: "one",
      value: "v",
    });
    await secrets.put(mutationCtx, {
      namespace: "a:prod",
      name: "two",
      value: "v",
    });
    const result = await secrets.list(queryCtx, {
      namespace: "a:prod",
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(result.page).toHaveLength(2);
    expect(result.page[0]?.effectiveState).toBe("active");
  });

  test("host pages through every secret exactly once with native cursors", async () => {
    const t = initConvexTest();
    const { mutationCtx, queryCtx } = ctxFrom(t);
    const secrets = new SecretStore(components.secretStore);
    const expected = [];
    for (let i = 0; i < 5; i++) {
      const { secretId } = await secrets.put(mutationCtx, {
        namespace: "workspace",
        name: `secret-${i}`,
        value: "v",
      });
      expected.push(secretId);
    }
    let cursor: string | null = null;
    let isDone = false;
    const seen = [];
    for (let page = 0; !isDone && page < 4; page++) {
      const result = await secrets.list(queryCtx, {
        namespace: "workspace",
        paginationOpts: { numItems: 2, cursor },
      });
      seen.push(...result.page.map((row) => row.secretId));
      cursor = result.continueCursor;
      isDone = result.isDone;
    }
    expect(isDone).toBe(true);
    expect(seen.sort()).toEqual(expected.sort());
  });

  test.each(["unfiltered", "name", "type", "secretId"] as const)(
    "host pages through every audit event exactly once with %s native cursors",
    async (filter) => {
      const t = initConvexTest();
      const { mutationCtx, queryCtx } = ctxFrom(t);
      const secrets = new SecretStore(components.secretStore);
      const { secretId } = await secrets.put(mutationCtx, {
        namespace: "workspace",
        name: "secret",
        value: "v",
      });
      for (let i = 0; i < 5; i++) {
        await secrets.put(mutationCtx, {
          namespace: "workspace",
          name: "secret",
          value: `v${i}`,
        });
      }
      const filters =
        filter === "secretId"
          ? { secretId }
          : filter === "name"
            ? { namespace: "workspace", name: "secret" }
            : filter === "type"
              ? { namespace: "workspace", type: "updated" as const }
              : { namespace: "workspace" };
      const expected = await secrets.listEvents(queryCtx, {
        ...filters,
        paginationOpts: { numItems: 10, cursor: null },
      });
      expect(expected.page).toHaveLength(filter === "type" ? 5 : 6);
      let cursor: string | null = null;
      let isDone = false;
      const seen = [];
      for (let page = 0; !isDone && page < 5; page++) {
        const result = await secrets.listEvents(queryCtx, {
          ...filters,
          paginationOpts: { numItems: 2, cursor },
        });
        seen.push(...result.page.map((row) => row.eventId));
        cursor = result.continueCursor;
        isDone = result.isDone;
      }
      expect(isDone).toBe(true);
      expect(seen.sort()).toEqual(
        expected.page.map((row) => row.eventId).sort(),
      );
      expect(new Set(seen).size).toBe(seen.length);
    },
  );

  test("rotate and isRotationComplete work through the facade", async () => {
    const t = initConvexTest();
    const { mutationCtx, queryCtx } = ctxFrom(t);
    const secrets = new SecretStore(components.secretStore);

    resetKeyConfig();
    process.env.SECRET_STORE_KEYS = defineKeys({ 1: RAW_V1 });
    await secrets.put(mutationCtx, { name: "k", value: "v" });

    resetKeyConfig();
    process.env.SECRET_STORE_KEYS = defineKeys({
      1: RAW_V1,
      2: RAW_V2,
    });
    expect(await secrets.isRotationComplete(queryCtx)).toBe(false);
    const result = await secrets.rotate(mutationCtx);
    expect(result.isDone).toBe(true);
    expect(await secrets.isRotationComplete(queryCtx)).toBe(true);
  });

  test("cleanup runs through the facade with default retention", async () => {
    const t = initConvexTest();
    const { mutationCtx } = ctxFrom(t);
    const secrets = new SecretStore(components.secretStore);

    const secretsResult = await secrets.cleanupSecrets(mutationCtx);
    expect(secretsResult).toEqual({ deleted: 0, isDone: true });

    const eventsResult = await secrets.cleanupEvents(mutationCtx);
    expect(eventsResult).toEqual({ deleted: 0, isDone: true });
  });
});

test("pagination types accept native options and preserve optional result fields", () => {
  expectTypeOf<PaginationOptions>().toEqualTypeOf<NativePaginationOptions>();
  expectTypeOf<ListResult<Record<string, unknown>>>().toExtend<
    PaginationResult<ListItem<Record<string, unknown>>>
  >();
  expectTypeOf<ListResult<Record<string, unknown>>>().toHaveProperty(
    "splitCursor",
  );
  expectTypeOf<ListResult<Record<string, unknown>>>().toHaveProperty(
    "pageStatus",
  );
});

test.each(["list", "listEvents"] as const)(
  "%s forwards native options and split results",
  async (operation) => {
    const paginationOpts: PaginationOptions = {
      numItems: 10,
      cursor: "start",
      endCursor: "end",
      maximumRowsRead: 20,
      maximumBytesRead: 1024,
    };
    const result = {
      page: [],
      isDone: false,
      continueCursor: "end",
      splitCursor: "middle",
      pageStatus: "SplitRequired" as const,
    };
    const runQuery = vi.fn().mockResolvedValue(result);
    const store = new SecretStore(components.secretStore);
    expect(await store[operation]({ runQuery }, { paginationOpts })).toEqual(
      result,
    );
    expect(runQuery.mock.calls[0]?.[1]).toMatchObject({ paginationOpts });
  },
);

test("keyVersions reports versions in use through the facade", async () => {
  const t = initConvexTest();
  const { mutationCtx, queryCtx } = ctxFrom(t);
  const store = new SecretStore(components.secretStore);
  expect(await store.keyVersions(queryCtx)).toEqual([]);
  await store.put(mutationCtx, { name: "one", value: "v" });
  expect(await store.keyVersions(queryCtx)).toEqual([1]);
});

test("expiry arguments accept callers with and without now", () => {
  expectTypeOf<{ name: string }>().toExtend<GetArgs<string>>();
  expectTypeOf<{ name: string; now: number }>().toExtend<GetArgs<string>>();
  expectTypeOf<GetArgs<string>>()
    .toHaveProperty("now")
    .toEqualTypeOf<number | undefined>();
  expectTypeOf<ListArgs<string>>()
    .toHaveProperty("now")
    .toEqualTypeOf<number | undefined>();
});

test.each(["get", "list"] as const)(
  "%s sends the current time by default and preserves an explicit now",
  async (operation) => {
    const runQuery = vi.fn().mockResolvedValue(null);
    const secrets = new SecretStore(components.secretStore);
    const clock = vi.spyOn(Date, "now").mockReturnValue(1234);
    try {
      for (const now of [undefined, 0]) {
        if (operation === "get") {
          await secrets.get({ runQuery }, { name: "k", now });
          expect(runQuery.mock.lastCall?.[1]).toEqual({
            namespace: undefined,
            name: "k",
            now: now ?? 1234,
          });
        } else {
          const paginationOpts = { numItems: 10, cursor: null };
          await secrets.list({ runQuery }, { paginationOpts, now });
          expect(runQuery.mock.lastCall?.[1]).toEqual({
            namespace: undefined,
            paginationOpts,
            order: undefined,
            now: now ?? 1234,
          });
        }
      }
    } finally {
      clock.mockRestore();
    }
  },
);
