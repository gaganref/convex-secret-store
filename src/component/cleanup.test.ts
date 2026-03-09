/// <reference types="vite/client" />

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api.js";
import { initConvexTest } from "./setup.test.js";

describe("component cleanup", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-07T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("cleanupSecrets removes retained expired secrets and leaves perpetual secrets intact", async () => {
    const t = initConvexTest();
    await t.mutation(api.lib.put, {
      name: "permanent",
      encryptedValue: "ciphertext-1",
      iv: "iv-1",
      wrappedDEK: "wrapped-1",
      dekIv: "dekIv-1",
      keyVersion: 1,
    });
    await t.mutation(api.lib.put, {
      name: "expired",
      encryptedValue: "ciphertext-2",
      iv: "iv-2",
      wrappedDEK: "wrapped-2",
      dekIv: "dekIv-2",
      keyVersion: 1,
      expiresAt: Date.now() + 1_000,
    });

    vi.setSystemTime(new Date("2026-04-08T00:00:00.000Z"));

    const cleanupResult = await t.mutation(api.cleanup.cleanupSecrets, {
      retentionMs: 24 * 60 * 60 * 1000,
    });

    expect(cleanupResult.deleted).toBe(1);

    expect(
      await t.query(api.lib.has, { name: "permanent", now: Date.now() }),
    ).toBe(true);
    expect(
      await t.query(api.lib.has, { name: "expired", now: Date.now() }),
    ).toBe(false);

    const events = await t.query(api.lib.listEvents, {
      paginationOpts: { numItems: 20, cursor: null },
    });
    expect(events.page.some((event) => event.name === "expired")).toBe(true);
  });

  test("cleanupSecrets validates retentionMs", async () => {
    const t = initConvexTest();
    await expect(
      t.mutation(api.cleanup.cleanupSecrets, { retentionMs: 0 }),
    ).rejects.toThrow();
  });

  test("cleanupEvents deletes retained audit rows independently", async () => {
    const t = initConvexTest();
    await t.mutation(api.lib.put, {
      name: "old-event-secret",
      encryptedValue: "ciphertext",
      iv: "iv",
      wrappedDEK: "wrapped",
      dekIv: "dekIv",
      keyVersion: 1,
    });

    vi.setSystemTime(new Date("2026-10-07T00:00:00.000Z"));

    const cleanup = await t.mutation(api.cleanup.cleanupEvents, {
      retentionMs: 24 * 60 * 60 * 1000,
    });

    expect(cleanup.deleted).toBeGreaterThan(0);
  });

  test("cleanupEvents validates retentionMs", async () => {
    const t = initConvexTest();
    await expect(
      t.mutation(api.cleanup.cleanupEvents, { retentionMs: 0 }),
    ).rejects.toThrow();
  });
});
