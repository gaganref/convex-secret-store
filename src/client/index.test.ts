import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { SecretStore, isSecretStoreError } from "./index.js";
import { components, initConvexTest } from "./setup.test.js";
import { defineKeys } from "../keys-format.js";
import { resetKeyConfig } from "../component/keys.js";
import type { RunMutationCtx, RunQueryCtx } from "./types.js";

const RAW_V1 = Buffer.alloc(32, 1).toString("base64");
const RAW_V2 = Buffer.alloc(32, 2).toString("base64");

beforeEach(() => {
  resetKeyConfig();
  process.env.SECRET_STORE_KEYS = defineKeys([{ version: 1, value: RAW_V1 }]);
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

  test("has reports presence through the facade", async () => {
    const t = initConvexTest();
    const { mutationCtx, queryCtx } = ctxFrom(t);
    const secrets = new SecretStore(components.secretStore);

    expect(await secrets.has(queryCtx, { name: "openai" })).toBe(false);
    await secrets.put(mutationCtx, { name: "openai", value: "sk" });
    expect(await secrets.has(queryCtx, { name: "openai" })).toBe(true);
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
    expect(await secrets.has(queryCtx, { name: "openai" })).toBe(false);
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

  test("rotate and isRotationComplete work through the facade", async () => {
    const t = initConvexTest();
    const { mutationCtx, queryCtx } = ctxFrom(t);
    const secrets = new SecretStore(components.secretStore);

    resetKeyConfig();
    process.env.SECRET_STORE_KEYS = defineKeys([{ version: 1, value: RAW_V1 }]);
    await secrets.put(mutationCtx, { name: "k", value: "v" });

    resetKeyConfig();
    process.env.SECRET_STORE_KEYS = defineKeys([
      { version: 1, value: RAW_V1 },
      { version: 2, value: RAW_V2 },
    ]);
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
