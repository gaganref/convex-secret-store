import { afterEach, expect, test, vi } from "vitest";
import type { PaginationOptions } from "convex/server";
import { api } from "./_generated/api.js";
import { initConvexTest } from "./setup.test.js";

// Captured from real paginate calls, without rewriting their cursors.
const nativeCursors = [
  {
    source: "convex-test 0.0.53, by_namespace_and_updated_at",
    cursor:
      '["\\"workspace\\"","1234","1794376429374","\\"0000000000000000000010000secrets\\""]',
  },
  {
    source: "convex-test 0.0.67, by_namespace_and_updated_at",
    cursor:
      '["\\"workspace\\"","1234","1794376016189","\\"0000000000000000000010000secrets\\""]',
  },
  {
    source: "local backend precompiled-2026-10-22-1447815, example:listSecrets",
    cursor:
      "079ab34b9950b3a8d83b42b54160d83ad6463e045801c6ca27a643dec534e0e37e9e7f70cf5e50d634079d737af165ed8df80cc2e191177022c53b0115b6957cc17a30fc20127318e569a5aeb6e035a060970193f08e74abe5a950a9271a9dfb61b06ec36b30438b0229da0f589c3f00c96e7b140f59674d8bfa1e5da89aedfdb3f0bb1846ece75f0d601a94f0193af413480ed27f36cd9ca2e3",
  },
];

// Captured with convex-helpers 0.1.134 on by_namespace_and_updated_at.
const legacyCursor =
  '["workspace",1235,1794376016189.002,"0000000000000000000010002secrets"]';

afterEach(() => vi.restoreAllMocks());

async function receivedOptions(options: PaginationOptions) {
  const t = initConvexTest();
  let received: PaginationOptions | undefined;
  await t.run(async (ctx) => {
    const query = ctx.db.query("secrets").order("asc");
    const prototype = Object.getPrototypeOf(query) as typeof query;
    vi.spyOn(prototype, "paginate").mockImplementation(
      async (options: PaginationOptions) => {
        received = options;
        return { page: [], isDone: true, continueCursor: "" };
      },
    );
  });
  await t.query(api.lib.list, { now: 0, paginationOpts: options });
  return received;
}

test.each(nativeCursors)(
  "preserves native boundaries from $source",
  async ({ cursor }) => {
    const options = {
      numItems: 2,
      cursor,
      endCursor: cursor,
      maximumRowsRead: 10,
      maximumBytesRead: 1024,
      id: 7,
    };
    expect(await receivedOptions(options)).toEqual(options);
  },
);

test.each(["[", '["workspace",0]', '["unexpected"]', "opaque-cursor"])(
  "leaves unrecognized cursor %s to native pagination",
  async (cursor) => {
    expect(
      await receivedOptions({ numItems: 2, cursor, endCursor: cursor }),
    ).toEqual({ numItems: 2, cursor, endCursor: cursor });
  },
);

test("restarts only the legacy boundary in mixed page ranges", async () => {
  const cursor = nativeCursors[0]!.cursor;
  expect(
    await receivedOptions({ numItems: 2, cursor, endCursor: legacyCursor }),
  ).toEqual({ numItems: 2, cursor, endCursor: null });
  expect(
    await receivedOptions({
      numItems: 2,
      cursor: legacyCursor,
      endCursor: cursor,
    }),
  ).toEqual({ numItems: 2, cursor: null, endCursor: cursor });
});

test("restarts the convex-helpers end sentinel", async () => {
  expect(
    await receivedOptions({ numItems: 2, cursor: "[]", endCursor: "[]" }),
  ).toEqual({ numItems: 2, cursor: null, endCursor: null });
});
