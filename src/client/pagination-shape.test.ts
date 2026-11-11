/// <reference types="vite/client" />
import { afterEach, beforeEach, expect, expectTypeOf, test } from "vitest";
import { convexTest } from "convex-test";
import {
  defineSchema,
  makeFunctionReference,
  paginationOptsValidator,
  queryGeneric,
  type PaginationOptions,
} from "convex/server";
import { v } from "convex/values";
import { register } from "../test.js";
import {
  SecretStore,
  type ListResult,
  type ListItem,
  type ListEventsResult,
} from "./index.js";
import { components } from "./setup.test.js";
import { defineKeys } from "../keys-format.js";
import { resetKeyConfig } from "../component/keys.js";
import {
  effectiveStateValidator,
  metadataValidator,
  secretEventTypeValidator,
} from "../shared.js";

const listItemValidator = v.object({
  secretId: v.string(),
  namespace: v.optional(v.string()),
  name: v.string(),
  metadata: v.optional(metadataValidator),
  createdAt: v.number(),
  updatedAt: v.number(),
  expiresAt: v.optional(v.number()),
  effectiveState: effectiveStateValidator,
  keyVersion: v.number(),
});
const eventItemValidator = v.object({
  eventId: v.string(),
  secretId: v.string(),
  namespace: v.optional(v.string()),
  name: v.string(),
  type: secretEventTypeValidator,
  metadata: v.optional(metadataValidator),
  createdAt: v.number(),
});
const listReturns = v.object({
  page: v.array(listItemValidator),
  isDone: v.boolean(),
  continueCursor: v.string(),
});
const eventsReturns = v.object({
  page: v.array(eventItemValidator),
  isDone: v.boolean(),
  continueCursor: v.string(),
});
const secrets = new SecretStore(components.secretStore);

function initLegacyHost() {
  const t = convexTest({
    schema: defineSchema({}),
    modules: {
      ...import.meta.glob("./**/*.*s"),
      "./legacyPaginationHost.ts": async () => ({
        list: queryGeneric({
          args: { paginationOpts: paginationOptsValidator },
          returns: listReturns,
          handler: async (ctx, args) => await secrets.list(ctx, args),
        }),
        listEvents: queryGeneric({
          args: {
            paginationOpts: paginationOptsValidator,
            name: v.optional(v.string()),
            type: v.optional(secretEventTypeValidator),
            secretId: v.optional(v.string()),
          },
          returns: eventsReturns,
          handler: async (ctx, args) =>
            await ctx.runQuery(components.secretStore.lib.listEvents, args),
        }),
      }),
    },
    transactionLimits: true,
  });
  register(t);
  return t;
}

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

test.each(["list", "listEvents"] as const)(
  "%s keeps the v0.2.1 host result shape across pages",
  async (operation) => {
    const t = initLegacyHost();
    for (const name of ["first", "second", "third"]) {
      await t.mutation(components.secretStore.lib.put, { name, value: "v" });
    }
    const query = makeFunctionReference<
      "query",
      { paginationOpts: PaginationOptions },
      ListResult<Record<string, unknown>> | ListEventsResult
    >(`legacyPaginationHost:${operation}`);
    let cursor: string | null = null;
    const names: string[] = [];
    for (let i = 0; i < 3; i++) {
      const result: ListResult<Record<string, unknown>> | ListEventsResult =
        await t.query(query, {
          paginationOpts: { numItems: 1, cursor },
        });
      expect(Object.keys(result).sort()).toEqual([
        "continueCursor",
        "isDone",
        "page",
      ]);
      expect(result.page).toHaveLength(1);
      expect(result.isDone).toBe(i === 2);
      names.push(result.page[0].name);
      cursor = result.continueCursor;
    }
    expect(names.sort()).toEqual(["first", "second", "third"]);
  },
);

test.each(["unfiltered", "name", "type", "secretId"] as const)(
  "listEvents keeps the v0.2.1 host result shape filtered by %s",
  async (filter) => {
    const t = initLegacyHost();
    const { secretId } = await t.mutation(components.secretStore.lib.put, {
      name: "target",
      value: "v",
    });
    await t.mutation(components.secretStore.lib.put, {
      name: "target",
      value: "new",
    });
    await t.mutation(components.secretStore.lib.put, {
      namespace: "other",
      name: "outside",
      value: "v",
    });
    const filters = {
      unfiltered: {},
      name: { name: "target" },
      type: { type: "updated" },
      secretId: { secretId },
    };
    const result = await t.query(
      makeFunctionReference<"query">("legacyPaginationHost:listEvents"),
      {
        ...filters[filter],
        paginationOpts: { numItems: 10, cursor: null },
      },
    );
    expect(Object.keys(result).sort()).toEqual([
      "continueCursor",
      "isDone",
      "page",
    ]);
    expect(result.isDone).toBe(true);
    expect(
      result.page.map((event: { type: string }) => event.type).sort(),
    ).toEqual(filter === "type" ? ["updated"] : ["created", "updated"]);
  },
);

test("facade result types have exactly the v0.2.1 page fields", () => {
  expectTypeOf<ListResult<Record<string, unknown>>>().toEqualTypeOf<{
    page: Array<ListItem<Record<string, unknown>>>;
    isDone: boolean;
    continueCursor: string;
  }>();
  expectTypeOf<keyof ListEventsResult>().toEqualTypeOf<
    "page" | "isDone" | "continueCursor"
  >();
});
