import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "./_generated/api.js";
import { initConvexTest } from "./setup.test.js";
import { defineKeys } from "../keys-format.js";
import { resetKeyConfig } from "./keys.js";

beforeEach(() => {
  resetKeyConfig();
  process.env.SECRET_STORE_KEYS = defineKeys({
    1: Buffer.alloc(32, 1).toString("base64"),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  resetKeyConfig();
  delete process.env.SECRET_STORE_KEYS;
});

const cursorError = {
  data: {
    code: "invalid_argument",
    message: "cursor does not belong to this query",
  },
};

test("list refuses a page holding another namespace's secret", async () => {
  const t = initConvexTest();
  const { secretId } = await t.mutation(api.lib.put, {
    namespace: "a-victim",
    name: "private-name",
    value: "v",
  });
  await t.run(async (ctx) => {
    const foreignRow = await ctx.db.get("secrets", secretId);
    const query = ctx.db.query("secrets").order("asc");
    vi.spyOn(Object.getPrototypeOf(query), "paginate").mockResolvedValue({
      page: [foreignRow],
      isDone: true,
      continueCursor: "end",
    });
  });
  await expect(
    t.query(api.lib.list, {
      namespace: "z-attacker",
      paginationOpts: { numItems: 10, cursor: "crafted" },
      now: Date.now(),
    }),
  ).rejects.toMatchObject(cursorError);
});

test("listEvents refuses a page holding an event outside the filter", async () => {
  const t = initConvexTest();
  await t.mutation(api.lib.put, {
    namespace: "z-attacker",
    name: "public-name",
    value: "v",
  });
  await t.run(async (ctx) => {
    const foreignRow = await ctx.db.query("secretEvents").first();
    const query = ctx.db.query("secretEvents").order("asc");
    vi.spyOn(Object.getPrototypeOf(query), "paginate").mockResolvedValue({
      page: [foreignRow],
      isDone: true,
      continueCursor: "end",
    });
  });
  await expect(
    t.query(api.lib.listEvents, {
      namespace: "z-attacker",
      type: "updated",
      paginationOpts: { numItems: 10, cursor: "crafted" },
    }),
  ).rejects.toMatchObject(cursorError);
});
