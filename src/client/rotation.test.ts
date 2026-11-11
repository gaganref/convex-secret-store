/// <reference types="vite/client" />
import { afterEach, beforeEach, expect, expectTypeOf, test, vi } from "vitest";
import { convexTest } from "convex-test";
import {
  defineSchema,
  makeFunctionReference,
  mutationGeneric,
} from "convex/server";
import { v } from "convex/values";
import component from "../test.js";
import { SecretStore, type RotateResult } from "./index.js";
import { components, initConvexTest } from "./setup.test.js";
import { defineKeys } from "../keys-format.js";
import { resetKeyConfig } from "../component/keys.js";

const V1 = Buffer.alloc(32, 1).toString("base64");
const V2 = Buffer.alloc(32, 2).toString("base64");
const V3 = Buffer.alloc(32, 3).toString("base64");
const secrets = new SecretStore(components.secretStore);
const legacyRotate = makeFunctionReference<"mutation">("legacyHost:rotate");

beforeEach(() => {
  vi.useFakeTimers();
  resetKeyConfig();
  process.env.SECRET_STORE_KEYS = defineKeys({ 1: V1 });
});

afterEach(() => {
  resetKeyConfig();
  delete process.env.SECRET_STORE_KEYS;
  vi.useRealTimers();
});

test("rotate satisfies a host's exact v0.2.1 returns validator with orphans", async () => {
  const t = convexTest({
    schema: defineSchema({}),
    modules: {
      ...import.meta.glob("./**/*.*s"),
      "./legacyHost.ts": async () => ({
        rotate: mutationGeneric({
          args: {},
          returns: v.object({
            isDone: v.boolean(),
            rotated: v.number(),
            skipped: v.number(),
          }),
          handler: async (ctx) => await secrets.rotate(ctx),
        }),
      }),
    },
    transactionLimits: true,
  });
  component.register(t);
  await t.mutation(components.secretStore.lib.put, {
    name: "orphan",
    value: "kept",
  });
  process.env.SECRET_STORE_KEYS = defineKeys({ 2: V2 });
  await t.mutation(components.secretStore.lib.put, {
    name: "healthy",
    value: "kept",
  });
  process.env.SECRET_STORE_KEYS = defineKeys({ 2: V2, 3: V3 });
  expect(await t.mutation(legacyRotate, {})).toEqual({
    rotated: 1,
    skipped: 0,
    isDone: true,
  });
  expect(await t.query(components.secretStore.lib.keyVersions, {})).toEqual([
    1, 3,
  ]);
});

test("orphanKeyVersions reports distinct missing versions through the facade", async () => {
  const t = initConvexTest();
  const orphanKeyVersions = () =>
    t.query((ctx) => secrets.orphanKeyVersions(ctx));
  expect(await orphanKeyVersions()).toEqual([]);
  await t.mutation(components.secretStore.lib.put, {
    name: "first",
    value: "v",
  });
  await t.mutation(components.secretStore.lib.put, {
    name: "second",
    value: "v",
  });
  process.env.SECRET_STORE_KEYS = defineKeys({ 3: V3 });
  await t.mutation(components.secretStore.lib.put, {
    name: "higher",
    value: "v",
  });
  process.env.SECRET_STORE_KEYS = defineKeys({ 2: V2 });
  await t.mutation(components.secretStore.lib.put, {
    name: "active",
    value: "v",
  });
  expect(await orphanKeyVersions()).toEqual([1, 3]);
  expect(await t.query((ctx) => secrets.keyVersions(ctx))).toEqual([1, 2, 3]);
  process.env.SECRET_STORE_KEYS = defineKeys({ 1: V1, 2: V2, 3: V3 });
  expect(await orphanKeyVersions()).toEqual([]);
});

test("RotateResult has exactly the v0.2.1 fields", () => {
  expectTypeOf<RotateResult>().toEqualTypeOf<{
    rotated: number;
    skipped: number;
    isDone: boolean;
  }>();
});
