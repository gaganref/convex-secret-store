/// <reference types="vite/client" />
import { afterEach, beforeEach, expect, test } from "vitest";
import { convexTest } from "convex-test";
import {
  defineSchema,
  makeFunctionReference,
  type PaginationOptions,
} from "convex/server";
import component from "../test.js";
import { defineKeys } from "../keys-format.js";
import { resetKeyConfig } from "../component/keys.js";

function initConvexTest() {
  const t = convexTest({
    schema: defineSchema({}),
    modules: import.meta.glob("../../example/convex/**/*.*s"),
    transactionLimits: true,
  });
  component.register(t);
  return t;
}

const listSecrets = makeFunctionReference<
  "query",
  {
    workspace: string;
    environment: "production";
    paginationOpts: PaginationOptions;
  }
>("example:listSecrets");
const listActivity = makeFunctionReference<
  "query",
  {
    workspace: string;
    environment: "production";
    paginationOpts: PaginationOptions;
    type?: "created" | "updated" | "deleted" | "rotated";
  }
>("example:listActivity");
const putSecret = makeFunctionReference<
  "mutation",
  {
    workspace: string;
    environment: "production";
    name: string;
    value: string;
  }
>("example:putSecret");
const getSettingsSnapshot = makeFunctionReference<
  "query",
  {
    workspace: string;
    environment: "production";
  }
>("example:getSettingsSnapshot");

beforeEach(() => {
  resetKeyConfig();
  process.env.SECRET_STORE_KEYS = defineKeys({
    1: Buffer.alloc(32, 1).toString("base64"),
  });
});

afterEach(() => {
  resetKeyConfig();
  delete process.env.SECRET_STORE_KEYS;
});

test.each([
  { name: "listSecrets", query: listSecrets },
  { name: "listActivity", query: listActivity },
])(
  "$name scopes anonymous demo results to the requested workspace",
  async ({ query }) => {
    const t = initConvexTest();
    await t.mutation(putSecret, {
      workspace: "other",
      environment: "production",
      name: "private",
      value: "v",
    });
    const own = await t.query(query, {
      workspace: "other",
      environment: "production",
      paginationOpts: { numItems: 50, cursor: null },
    });
    expect(own.page).toHaveLength(1);
    expect(
      await t.query(query, {
        workspace: "empty",
        environment: "production",
        paginationOpts: { numItems: 50, cursor: null },
      }),
    ).toMatchObject({ page: [], isDone: true });
  },
);

test("settings uses a bounded summary and the store-wide key versions", async () => {
  const t = initConvexTest();
  for (let i = 0; i < 105; i++) {
    await t.mutation(putSecret, {
      workspace: "demo",
      environment: "production",
      name: `secret-${i}`,
      value: "v",
    });
  }
  const snapshot = await t.query(getSettingsSnapshot, {
    workspace: "demo",
    environment: "production",
  });
  expect(snapshot).toMatchObject({
    totalSecrets: 100,
    snapshotComplete: false,
    keyVersions: [1],
  });
});

test("activity type filter finds events beyond the first unfiltered page", async () => {
  const t = initConvexTest();
  for (let i = 0; i < 55; i++) {
    await t.mutation(putSecret, {
      workspace: "demo",
      environment: "production",
      name: `secret-${i}`,
      value: "v",
    });
  }
  await t.mutation(putSecret, {
    workspace: "demo",
    environment: "production",
    name: "secret-0",
    value: "new",
  });
  const result = await t.query(listActivity, {
    workspace: "demo",
    environment: "production",
    type: "created",
    paginationOpts: { numItems: 50, cursor: null },
  });
  expect(result.page).toHaveLength(50);
  expect(
    result.page.every((event: { type: string }) => event.type === "created"),
  ).toBe(true);
  expect(result.isDone).toBe(false);
});
