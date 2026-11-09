import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "./_generated/api.js";
import { initConvexTest } from "./setup.test.js";
import { defineKeys } from "../keys-format.js";
import { resetKeyConfig } from "./keys.js";

// Stands in for a paginator that lets a cursor reach rows outside the index
// range, as convex-helpers before 0.1.134 did.
const foreignRow = vi.hoisted(() => ({
  current: undefined as Record<string, unknown> | undefined,
}));

vi.mock("convex-helpers/server/pagination", () => {
  const chain = {
    withIndex: () => chain,
    order: () => chain,
    paginate: async () => ({
      page: [foreignRow.current],
      isDone: true,
      continueCursor: "end",
    }),
  };
  return { paginator: () => ({ query: () => chain }) };
});

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

const cursorError = {
  data: {
    code: "invalid_argument",
    message: "cursor does not belong to this query",
  },
};

test("list refuses a page holding another namespace's secret", async () => {
  const t = initConvexTest();
  foreignRow.current = { namespace: "a-victim", name: "private-name" };
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
  foreignRow.current = {
    namespace: "z-attacker",
    name: "public-name",
    type: "created",
  };
  await expect(
    t.query(api.lib.listEvents, {
      namespace: "z-attacker",
      type: "updated",
      paginationOpts: { numItems: 10, cursor: "crafted" },
    }),
  ).rejects.toMatchObject(cursorError);
});
