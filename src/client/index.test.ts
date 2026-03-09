import { afterEach, describe, expect, expectTypeOf, test, vi } from "vitest";
import {
  SecretStore,
  SecretStoreClientError,
  isSecretStoreClientError,
} from "./index.js";
import { normalizeSecretStoreOptions } from "./options.js";
import { components, initConvexTest } from "./setup.test.js";
import type { RunMutationCtx, RunQueryCtx } from "./types.js";

const KEY_V1 = Buffer.alloc(32, 1).toString("base64");
const KEY_V2 = Buffer.alloc(32, 2).toString("base64");

function ctxFrom(t: ReturnType<typeof initConvexTest>) {
  const mutationCtx: RunMutationCtx = {
    runMutation: (mutation, args) => t.mutation(mutation, args),
  };
  const queryCtx: RunQueryCtx = {
    runQuery: (query, args) => t.query(query, args),
  };
  return { mutationCtx, queryCtx, ctx: { ...mutationCtx, ...queryCtx } };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("SecretStore client", () => {
  test("constructs a typed client", () => {
    const client = new SecretStore(components.secretStore, {
      keys: [{ version: 1, value: KEY_V1 }],
    });

    expect(client).toBeInstanceOf(SecretStore);
    expect(client.options.activeVersion).toBe(1);
  });

  test("put/get round-trips a secret value", async () => {
    const t = initConvexTest();
    const { mutationCtx, queryCtx } = ctxFrom(t);
    const client = new SecretStore<{
      namespace: string;
      metadata: { provider: string };
    }>(components.secretStore, {
      keys: [{ version: 1, value: KEY_V1 }],
    });

    const created = await client.put(mutationCtx, {
      namespace: "acme:production",
      name: "openai",
      value: "sk-secret",
      metadata: { provider: "openai" },
    });

    expect(created.isNew).toBe(true);

    const loaded = await client.get(queryCtx, {
      namespace: "acme:production",
      name: "openai",
    });

    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value).toBe("sk-secret");
    expect(loaded.metadata).toEqual({ provider: "openai" });
  });

  test("returns key_version_unavailable when ciphertext version is not configured", async () => {
    const t = initConvexTest();
    const { mutationCtx, queryCtx } = ctxFrom(t);
    const initial = new SecretStore(components.secretStore, {
      keys: [{ version: 1, value: KEY_V1 }],
    });

    await initial.put(mutationCtx, {
      name: "stripe",
      value: "sk_live_123",
    });

    const rotatedOut = new SecretStore(components.secretStore, {
      keys: [{ version: 2, value: KEY_V2 }],
    });

    const result = await rotatedOut.get(queryCtx, { name: "stripe" });
    expect(result).toEqual({ ok: false, reason: "key_version_unavailable" });
  });

  test("rotateKeys rewraps rows to the active version", async () => {
    const t = initConvexTest();
    const { mutationCtx, queryCtx, ctx } = ctxFrom(t);
    const v1Client = new SecretStore(components.secretStore, {
      keys: [{ version: 1, value: KEY_V1 }],
    });

    await v1Client.put(mutationCtx, {
      name: "resend",
      value: "re_123",
    });

    const rotatingClient = new SecretStore(components.secretStore, {
      keys: [
        { version: 2, value: KEY_V2 },
        { version: 1, value: KEY_V1 },
      ],
    });

    const rotated = await rotatingClient.rotateKeys(ctx, {
      fromVersion: 1,
      batchSize: 10,
      cursor: null,
    });

    expect(rotated.processed).toBe(1);
    expect(rotated.rotated).toBe(1);
    expect(rotated.skipped).toBe(0);

    const listed = await rotatingClient.list(queryCtx, {
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(listed.page[0]?.keyVersion).toBe(2);

    const activeOnlyClient = new SecretStore(components.secretStore, {
      keys: [{ version: 2, value: KEY_V2 }],
    });
    const loaded = await activeOnlyClient.get(queryCtx, { name: "resend" });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value).toBe("re_123");
  });

  test("rotateKeys does not report done when a stale row still remains on the old version", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-09T12:00:00.000Z"));

    const t = initConvexTest();
    const { mutationCtx, queryCtx } = ctxFrom(t);
    const v1Client = new SecretStore<{
      metadata: { owner?: string };
    }>(components.secretStore, {
      keys: [{ version: 1, value: KEY_V1 }],
    });

    await v1Client.put(mutationCtx, {
      name: "github",
      value: "ghp_123",
      metadata: { owner: "platform" },
    });

    const rotatingClient = new SecretStore<{
      metadata: { owner?: string };
    }>(components.secretStore, {
      keys: [
        { version: 2, value: KEY_V2 },
        { version: 1, value: KEY_V1 },
      ],
    });

    let injectedConcurrentUpdate = false;
    const ctx: RunMutationCtx & RunQueryCtx = {
      runQuery: (query, args) => t.query(query, args),
      runMutation: async (mutation, args) => {
        if (!injectedConcurrentUpdate) {
          injectedConcurrentUpdate = true;
          vi.setSystemTime(new Date("2026-03-09T12:00:01.000Z"));
          await t.mutation(components.secretStore.lib.update, {
            name: "github",
            metadata: { owner: "rotated-later" },
          });
        }
        return await t.mutation(mutation, args);
      },
    };

    const result = await rotatingClient.rotateKeys(ctx, {
      fromVersion: 1,
      batchSize: 10,
      cursor: null,
    });

    expect(result.processed).toBe(1);
    expect(result.rotated).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.isDone).toBe(false);
    expect(result.continueCursor).toBeNull();

    const listed = await rotatingClient.list(queryCtx, {
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(listed.page[0]?.keyVersion).toBe(1);
  });

  test("client rejects empty namespace", async () => {
    const t = initConvexTest();
    const { mutationCtx } = ctxFrom(t);
    const client = new SecretStore<{ namespace: string }>(
      components.secretStore,
      {
        keys: [{ version: 1, value: KEY_V1 }],
      },
    );

    await expect(
      client.put(mutationCtx, {
        namespace: "" as string,
        name: "openai",
        value: "sk-secret",
      }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        isSecretStoreClientError(error) && error.code === "INVALID_ARGUMENT",
    );
  });

  test("has, update, and remove follow expected edge-result paths", async () => {
    const t = initConvexTest();
    const { mutationCtx, queryCtx } = ctxFrom(t);
    const client = new SecretStore(components.secretStore, {
      keys: [{ version: 1, value: KEY_V1 }],
    });

    expect(await client.has(queryCtx, { name: "missing" })).toBe(false);

    expect(
      await client.update(mutationCtx, {
        name: "missing",
        metadata: { owner: "nobody" },
      }),
    ).toEqual({ updated: false });

    expect(await client.remove(mutationCtx, { name: "missing" })).toEqual({
      removed: false,
    });
  });

  test("listEvents rejects name + type in the client surface", async () => {
    const client = new SecretStore(components.secretStore, {
      keys: [{ version: 1, value: KEY_V1 }],
    });
    const ctx: RunQueryCtx = {
      runQuery: async () => {
        throw new Error("should not be called");
      },
    };

    await expect(
      client.listEvents(ctx, {
        name: "openai",
        type: "created",
        paginationOpts: { numItems: 10, cursor: null },
      }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        isSecretStoreClientError(error) && error.code === "INVALID_ARGUMENT",
    );
  });

  test("listEvents supports secretId lookups without namespace", async () => {
    const t = initConvexTest();
    const { mutationCtx, queryCtx } = ctxFrom(t);
    const client = new SecretStore(components.secretStore, {
      keys: [{ version: 1, value: KEY_V1 }],
    });

    const created = await client.put(mutationCtx, {
      name: "slack",
      value: "xoxb-secret",
    });

    const events = await client.listEvents(queryCtx, {
      secretId: created.secretId,
      paginationOpts: { numItems: 10, cursor: null },
    });

    expect(events.page).toHaveLength(1);
    expect(events.page[0]?.secretId).toBe(created.secretId);
    expect(events.page[0]?.type).toBe("created");
  });

  test("rotateKeys validates version and batch arguments", async () => {
    const client = new SecretStore(components.secretStore, {
      keys: [
        { version: 2, value: KEY_V2 },
        { version: 1, value: KEY_V1 },
      ],
    });
    const ctx = {} as RunMutationCtx & RunQueryCtx;

    await expect(client.rotateKeys(ctx, { fromVersion: -1 })).rejects.toSatisfy(
      (error: unknown) =>
        isSecretStoreClientError(error) && error.code === "INVALID_ARGUMENT",
    );

    await expect(client.rotateKeys(ctx, { fromVersion: 2 })).rejects.toSatisfy(
      (error: unknown) =>
        isSecretStoreClientError(error) && error.code === "INVALID_ARGUMENT",
    );

    await expect(client.rotateKeys(ctx, { fromVersion: 9 })).rejects.toSatisfy(
      (error: unknown) =>
        isSecretStoreClientError(error) &&
        error.code === "KEY_VERSION_UNAVAILABLE",
    );

    await expect(
      client.rotateKeys(ctx, { fromVersion: 1, batchSize: 0 }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        isSecretStoreClientError(error) && error.code === "INVALID_ARGUMENT",
    );
  });

  test("cleanupSecrets and cleanupEvents validate retention arguments", async () => {
    const client = new SecretStore(components.secretStore, {
      keys: [{ version: 1, value: KEY_V1 }],
    });
    const ctx = {} as RunMutationCtx;

    await expect(
      client.cleanupSecrets(ctx, { retentionMs: 0 }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        isSecretStoreClientError(error) && error.code === "INVALID_ARGUMENT",
    );

    await expect(
      client.cleanupEvents(ctx, { retentionMs: 0 }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        isSecretStoreClientError(error) && error.code === "INVALID_ARGUMENT",
    );
  });
});

describe("error and option contracts", () => {
  test("normalizeSecretStoreOptions validates keys and defaults", () => {
    const normalized = normalizeSecretStoreOptions({
      keys: [{ version: 7, value: KEY_V1 }],
      defaults: { ttlMs: 60_000 },
      logLevel: "debug",
    });

    expect(normalized.activeVersion).toBe(7);
    expect(normalized.defaults.ttlMs).toBe(60_000);
    expect(normalized.logLevel).toBe("debug");
  });

  test("constructor throws typed INVALID_OPTIONS", () => {
    expect(
      () =>
        new SecretStore(components.secretStore, {
          keys: [],
        }),
    ).toThrow(SecretStoreClientError);
  });

  test("normalizeSecretStoreOptions rejects invalid key material and defaults", () => {
    expect(() =>
      normalizeSecretStoreOptions({
        keys: [{ version: 1, value: "" }],
      }),
    ).toThrow(SecretStoreClientError);

    expect(() =>
      normalizeSecretStoreOptions({
        keys: [
          { version: 1, value: KEY_V1 },
          { version: 1, value: KEY_V2 },
        ],
      }),
    ).toThrow(SecretStoreClientError);

    expect(() =>
      normalizeSecretStoreOptions({
        keys: [{ version: 1, value: Buffer.alloc(16, 1).toString("base64") }],
      }),
    ).toThrow(SecretStoreClientError);

    expect(() =>
      normalizeSecretStoreOptions({
        keys: [{ version: 1, value: KEY_V1 }],
        defaults: { ttlMs: -1 },
      }),
    ).toThrow(SecretStoreClientError);
  });

  test("operation failures preserve cause", async () => {
    const client = new SecretStore(components.secretStore, {
      keys: [{ version: 1, value: KEY_V1 }],
      logLevel: "none",
    });
    const ctx: RunQueryCtx = {
      runQuery: async () => {
        throw new Error("db down");
      },
    };

    const error = await client.get(ctx, { name: "missing" }).catch((e) => e);
    expect(isSecretStoreClientError(error)).toBe(true);
    if (isSecretStoreClientError(error)) {
      expect(error.code).toBe("OPERATION_FAILED");
      expect(error.cause).toBeInstanceOf(Error);
    }
  });
});

test("client type contracts remain stable", () => {
  const _baseClient = new SecretStore(components.secretStore, {
    keys: [{ version: 1, value: KEY_V1 }],
  });

  type BasePutArgs = Parameters<typeof _baseClient.put>[1];
  const basePutArgs: BasePutArgs = {
    name: "openai",
    value: "sk",
  };
  void basePutArgs;

  const _namespacedClient = new SecretStore<{ namespace: `env:${string}` }>(
    components.secretStore,
    {
      keys: [{ version: 1, value: KEY_V1 }],
    },
  );

  type NamespacedPutArgs = Parameters<typeof _namespacedClient.put>[1];
  const validNamespacedArgs: NamespacedPutArgs = {
    namespace: "env:prod",
    name: "openai",
    value: "sk",
  };
  expectTypeOf(validNamespacedArgs.namespace).toEqualTypeOf<`env:${string}`>();

  // @ts-expect-error namespace is required when configured in the generic.
  const missingNamespace: NamespacedPutArgs = { name: "openai", value: "sk" };
  void missingNamespace;

  type NamespacedListArgs = Parameters<typeof _namespacedClient.list>[1];
  const validNamespacedListArgs: NamespacedListArgs = {
    namespace: "env:prod",
    paginationOpts: { numItems: 10, cursor: null },
  };
  void validNamespacedListArgs;

  // @ts-expect-error namespace is required for list when configured in the generic.
  const missingListNamespace: NamespacedListArgs = {
    paginationOpts: { numItems: 10, cursor: null },
  };
  void missingListNamespace;

  type NamespacedListEventsArgs = Parameters<
    typeof _namespacedClient.listEvents
  >[1];
  const validNamespacedListEventsArgs: NamespacedListEventsArgs = {
    namespace: "env:prod",
    paginationOpts: { numItems: 10, cursor: null },
  };
  void validNamespacedListEventsArgs;

  // @ts-expect-error namespace is required for namespaced event listing unless querying by secretId.
  const missingEventsNamespace: NamespacedListEventsArgs = {
    paginationOpts: { numItems: 10, cursor: null },
  };
  void missingEventsNamespace;

  const _metadataClient = new SecretStore<{
    metadata: { provider: "openai" | "stripe"; label?: string };
  }>(components.secretStore, {
    keys: [{ version: 1, value: KEY_V1 }],
  });

  type MetadataPutArgs = Parameters<typeof _metadataClient.put>[1];
  const metadataArgs: MetadataPutArgs = {
    name: "stripe",
    value: "sk",
    metadata: { provider: "stripe", label: "primary" },
  };
  expectTypeOf(metadataArgs.metadata?.provider).toEqualTypeOf<
    "openai" | "stripe" | undefined
  >();
});
