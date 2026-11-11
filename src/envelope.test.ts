import { afterEach, describe, expect, test, vi } from "vitest";
import * as envelope from "convex-secret-store/envelope";
import {
  decryptSecret,
  defineKeys,
  encryptSecret,
  importKey,
  parseKeyEntries,
  rewrapDEK,
  type KeyEntry,
} from "convex-secret-store/envelope";
import { api } from "./component/_generated/api.js";
import { resetKeyConfig } from "./component/keys.js";
import { initConvexTest } from "./component/setup.test.js";
import reference from "./test-vectors/envelope.json" with { type: "json" };

const keys: KeyEntry[] = reference.keys;
const rawKeys = Object.fromEntries(
  keys.map(({ version, value }) => [version, value]),
);

afterEach(() => {
  vi.unstubAllEnvs();
  resetKeyConfig();
});

describe("convex-secret-store/envelope", () => {
  test("exports only the promised runtime functions", () => {
    expect(Object.keys(envelope).sort()).toEqual([
      "decryptSecret",
      "defineKeys",
      "encryptSecret",
      "importKey",
      "parseKeyEntries",
      "rewrapDEK",
    ]);
  });

  test("serializes and parses versioned KEKs", () => {
    expect(parseKeyEntries(defineKeys(rawKeys))).toEqual(keys);
  });

  // Captured once through api.lib.put and t.run on 3be0be8 with convex-test.
  test.each(reference.vectors)(
    "opens the component's $name ciphertext",
    async (vector) => {
      const value = await decryptSecret({
        ...vector.stored,
        namespace: vector.namespace,
        name: vector.name,
        kek: await importKey(rawKeys[vector.stored.keyVersion]),
      });
      expect(value).toBe(vector.plaintext);
    },
  );

  test.each([
    {
      namespace: "external:production",
      name: "api-key",
      value: "new secret 🔑\nwith a newline",
    },
    {
      namespace: undefined,
      name: "default-secret",
      value: "without a namespace",
    },
    { namespace: "external:staging", name: "empty-secret", value: "" },
  ])(
    "round-trips $name outside the component",
    async ({ value, ...identity }) => {
      const params = {
        ...identity,
        keyVersion: 1,
        kek: await importKey(rawKeys[1]),
      };
      const encrypted = await encryptSecret({ ...params, value });
      expect(await decryptSecret({ ...params, ...encrypted })).toBe(value);
    },
  );

  test("rewraps a component ciphertext under a second KEK version", async () => {
    const vector = reference.vectors[0];
    const identity = { namespace: vector.namespace, name: vector.name };
    const toKek = await importKey(rawKeys[2]);
    const rewrapped = await rewrapDEK({
      ...identity,
      wrappedDEK: vector.stored.wrappedDEK,
      dekIv: vector.stored.dekIv,
      fromVersion: vector.stored.keyVersion,
      toVersion: 2,
      fromKek: await importKey(rawKeys[vector.stored.keyVersion]),
      toKek,
    });
    expect(
      await decryptSecret({
        ...identity,
        ...vector.stored,
        ...rewrapped,
        keyVersion: 2,
        kek: toKek,
      }),
    ).toBe(vector.plaintext);
  });

  test.each(reference.vectors)(
    "the component opens externally encrypted $name",
    async (vector) => {
      vi.stubEnv("SECRET_STORE_KEYS", defineKeys(rawKeys));
      vi.stubEnv("SECRET_STORE_DEFAULT_TTL_MS", "");
      const t = initConvexTest();
      const identity = { namespace: vector.namespace, name: vector.name };
      const keyVersion = vector.stored.keyVersion;
      const encrypted = await encryptSecret({
        ...identity,
        value: vector.plaintext,
        keyVersion,
        kek: await importKey(rawKeys[keyVersion]),
      });
      await t.run((ctx) =>
        ctx.db.insert("secrets", {
          ...identity,
          ...encrypted,
          keyVersion,
          updatedAt: 1234,
        }),
      );
      expect(await t.query(api.lib.get, identity)).toMatchObject({
        ok: true,
        value: vector.plaintext,
      });
    },
  );
});
