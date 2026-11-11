import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api.js";
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
  expect(result).toEqual({ rotated: 1, skipped: 0, isDone: true });
  expect(await t.query(api.lib.orphanKeyVersions, {})).toEqual([0]);
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

test("restoring an older key mid-chain restarts the scan with the same active version", async () => {
  const t = initConvexTest();
  await t.mutation(api.lib.put, { name: "restored", value: "kept" });
  keys({ 2: V2 });
  for (let i = 0; i < 105; i++) {
    await t.mutation(api.lib.put, { name: `healthy-${i}`, value: "kept" });
  }
  const V3 = Buffer.alloc(32, 3).toString("base64");
  keys({ 2: V2, 3: V3 });
  expect(await t.mutation(api.lib.rotate, {})).toMatchObject({
    rotated: 100,
    isDone: false,
  });
  keys({ 1: V1, 2: V2, 3: V3 });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(await t.query(api.lib.keyVersions, {})).toEqual([3]);
  expect(await t.query(api.lib.isRotationComplete, {})).toBe(true);
  expect(await t.mutation(api.lib.rotate, {})).toEqual({
    rotated: 0,
    skipped: 0,
    isDone: true,
  });
});

test("continuations warn once per orphan version and once per failed unwrap without secret values", async () => {
  const t = initConvexTest();
  const value = "private-value-never-log";
  for (let i = 0; i < 100; i++) {
    await t.mutation(api.lib.put, { name: `healthy-${i}`, value });
  }
  keys({ 2: V2 });
  await t.mutation(api.lib.put, { name: "broken", value });
  for (let i = 0; i < 5; i++) {
    await t.run((ctx) =>
      ctx.db.insert("secrets", {
        name: `orphan-${i}`,
        encryptedValue: "private-ciphertext-never-log",
        iv: "x",
        wrappedDEK: "private-wrapped-key-never-log",
        dekIv: "x",
        keyVersion: 4,
        updatedAt: Date.now(),
      }),
    );
  }
  const V3 = Buffer.alloc(32, 3).toString("base64");
  keys({ 1: V1, 2: V1, 3: V3 });
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    expect(await t.mutation(api.lib.rotate, {})).toMatchObject({
      rotated: 100,
      skipped: 0,
      isDone: false,
    });
    expect(warn).not.toHaveBeenCalled();
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(warn).toHaveBeenCalledTimes(2);
    const warnings = warn.mock.calls.map((args) => args.join(" "));
    expect(warnings).toContainEqual(
      expect.stringMatching(/secret "broken".*keyVersion 2.*failed/),
    );
    expect(warnings).toContainEqual(
      expect.stringMatching(/keyVersion 4.*left untouched.*re-added.*removed/),
    );
    for (const sensitive of [
      V1,
      V2,
      V3,
      value,
      "private-ciphertext-never-log",
      "private-wrapped-key-never-log",
    ]) {
      expect(warnings.join(" ")).not.toContain(sensitive);
    }
    expect(await t.query(api.lib.isRotationComplete, {})).toBe(false);
  } finally {
    warn.mockRestore();
  }
});

test("queued continuations without a key-set fingerprint still drain", async () => {
  const t = initConvexTest();
  await t.mutation(api.lib.put, { name: "legacy", value: "kept" });
  keys({ 1: V1, 2: V2 });
  expect(
    await t.mutation(internal.rotation.continueRotation, {
      active: 2,
      position: { kind: "scan", afterVersion: 1 },
    }),
  ).toEqual({ rotated: 1, skipped: 0, isDone: true });
  expect(await t.query(api.lib.isRotationComplete, {})).toBe(true);
});

test("reordering configured keys preserves progress past failed unwraps", async () => {
  const t = initConvexTest();
  for (let i = 0; i < 100; i++) {
    await t.mutation(api.lib.put, { name: `broken-${i}`, value: "broken" });
  }
  keys({ 1: V2 });
  await t.mutation(api.lib.put, { name: "healthy", value: "kept" });
  keys({ 1: V2, 2: V1 });
  expect(await t.mutation(api.lib.rotate, {})).toEqual({
    rotated: 0,
    skipped: 100,
    isDone: false,
  });
  process.env.SECRET_STORE_KEYS = process.env
    .SECRET_STORE_KEYS!.split(",")
    .reverse()
    .join(",");
  resetKeyConfig();
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  const listed = await t.query(api.lib.list, {
    paginationOpts: { numItems: 101, cursor: null },
  });
  expect(
    listed.page.find((secret) => secret.name === "healthy")?.keyVersion,
  ).toBe(2);
  expect(await t.query(api.lib.isRotationComplete, {})).toBe(false);
});
