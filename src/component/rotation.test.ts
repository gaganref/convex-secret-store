import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "./_generated/api.js";
import { initConvexTest } from "./setup.test.js";
import { defineKeys } from "../keys-format.js";
import { resetKeyConfig } from "./keys.js";

const V1 = Buffer.alloc(32, 1).toString("base64");
const V2 = Buffer.alloc(32, 2).toString("base64");
const metadata = { large: "x".repeat(256 * 1024) };

function keys(versions: Record<number, string>) {
  process.env.SECRET_STORE_KEYS = defineKeys(versions);
  resetKeyConfig();
}

beforeEach(() => {
  vi.useFakeTimers();
  keys({ 1: V1 });
});

afterEach(() => {
  resetKeyConfig();
  delete process.env.SECRET_STORE_KEYS;
  vi.useRealTimers();
});

test("rotation passes 100 removed-key secrets and reports their version", async () => {
  const t = initConvexTest();
  for (let i = 0; i < 100; i++) {
    await t.run((ctx) =>
      ctx.db.insert("secrets", {
        name: `orphan-${i}`,
        encryptedValue: "x",
        iv: "x",
        wrappedDEK: "x",
        dekIv: "x",
        keyVersion: 0,
        updatedAt: Date.now(),
      }),
    );
  }
  await t.mutation(api.lib.put, { name: "healthy", value: "kept" });
  keys({ 1: V1, 2: V2 });
  const result = await t.mutation(api.lib.rotate, {});
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(result).toMatchObject({ orphanVersions: [0], skipped: 0 });
  expect(
    await t.query(api.lib.get, { name: "healthy", now: Date.now() }),
  ).toMatchObject({ ok: true, value: "kept" });
  const listed = await t.query(api.lib.list, {
    paginationOpts: { numItems: 101, cursor: null },
  });
  expect(listed.page.find((row) => row.name === "healthy")?.keyVersion).toBe(2);
  expect(await t.query(api.lib.isRotationComplete, {})).toBe(false);
});

test("rotation passes 100 failed unwraps and terminates after a healthy secret", async () => {
  vi.setSystemTime(8e15);
  const t = initConvexTest();
  for (let i = 0; i < 100; i++) {
    await t.mutation(api.lib.put, { name: `broken-${i}`, value: "broken" });
  }
  keys({ 1: V2 });
  await t.mutation(api.lib.put, { name: "healthy", value: "kept" });
  keys({ 1: V2, 2: V1 });
  const result = await t.mutation(api.lib.rotate, {});
  expect(result).toMatchObject({ skipped: 100, isDone: false });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(
    await t.query(api.lib.get, { name: "healthy", now: Date.now() }),
  ).toMatchObject({ ok: true, value: "kept" });
  const listed = await t.query(api.lib.list, {
    paginationOpts: { numItems: 101, cursor: null },
  });
  expect(listed.page.find((row) => row.name === "healthy")?.keyVersion).toBe(2);
  expect(await t.mutation(api.lib.rotate, {})).toMatchObject({ skipped: 100 });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
});

test("rotation drains tied creation times across continuations", async () => {
  vi.setSystemTime(8e15);
  const t = initConvexTest();
  for (let i = 0; i < 205; i++) {
    await t.mutation(api.lib.put, { name: `tie-${i}`, value: "v" });
  }
  const rows = await t.query(api.lib.list, {
    paginationOpts: { numItems: 205, cursor: null },
  });
  expect(rows.page).toHaveLength(205);
  expect(new Set(rows.page.map((row) => row.createdAt)).size).toBeLessThan(3);
  keys({ 1: V1, 2: V2 });
  await t.mutation(api.lib.rotate, {});
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(await t.query(api.lib.isRotationComplete, {})).toBe(true);
});

test("rotation drains 100 secrets with 256 KiB metadata inside transaction limits", async () => {
  const t = initConvexTest();
  for (let i = 0; i < 100; i++) {
    await t.mutation(api.lib.put, { name: `large-${i}`, value: "v", metadata });
  }
  keys({ 1: V1, 2: V2 });
  await t.mutation(api.lib.rotate, {});
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(await t.query(api.lib.isRotationComplete, {})).toBe(true);
});
