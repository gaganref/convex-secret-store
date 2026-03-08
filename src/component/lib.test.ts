/// <reference types="vite/client" />

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api.js";
import { initConvexTest } from "./setup.test.js";

describe("component lib", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-07T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("put/get/has/list round-trip for a non-namespaced secret", async () => {
    const t = initConvexTest();
    const putResult = await t.mutation(api.lib.put, {
      name: "openai",
      encryptedValue: "ciphertext",
      iv: "iv",
      wrappedDEK: "wrapped",
      dekIv: "dekIv",
      keyVersion: 1,
      metadata: { provider: "openai" },
      expiresAt: Date.now() + 60_000,
    });

    expect(putResult.isNew).toBe(true);

    const hasSecret = await t.query(api.lib.has, {
      name: "openai",
      now: Date.now(),
    });
    expect(hasSecret).toBe(true);

    const getResult = await t.query(api.lib.get, {
      name: "openai",
      now: Date.now(),
    });
    expect(getResult).toEqual({
      ok: true,
      encryptedValue: "ciphertext",
      iv: "iv",
      wrappedDEK: "wrapped",
      dekIv: "dekIv",
      keyVersion: 1,
      metadata: { provider: "openai" },
      expiresAt: Date.now() + 60_000,
      updatedAt: Date.now(),
    });

    const listResult = await t.query(api.lib.list, {
      paginationOpts: { numItems: 10, cursor: null },
      now: Date.now(),
    });
    expect(listResult.page).toHaveLength(1);
    expect(listResult.page[0]).toMatchObject({
      name: "openai",
      keyVersion: 1,
      effectiveState: "active",
    });
  });

  test("put overwrite preserves omitted metadata and expiry, and null clears them", async () => {
    const t = initConvexTest();
    const firstExpiry = Date.now() + 60_000;
    await t.mutation(api.lib.put, {
      namespace: "acme:production",
      name: "resend",
      encryptedValue: "ciphertext-1",
      iv: "iv-1",
      wrappedDEK: "wrapped-1",
      dekIv: "dekIv-1",
      keyVersion: 1,
      metadata: { owner: "platform" },
      expiresAt: firstExpiry,
    });

    await t.mutation(api.lib.put, {
      namespace: "acme:production",
      name: "resend",
      encryptedValue: "ciphertext-2",
      iv: "iv-2",
      wrappedDEK: "wrapped-2",
      dekIv: "dekIv-2",
      keyVersion: 2,
    });

    const preserved = await t.query(api.lib.get, {
      namespace: "acme:production",
      name: "resend",
      now: Date.now(),
    });
    expect(preserved).toMatchObject({
      ok: true,
      metadata: { owner: "platform" },
      expiresAt: firstExpiry,
      keyVersion: 2,
    });

    await t.mutation(api.lib.put, {
      namespace: "acme:production",
      name: "resend",
      encryptedValue: "ciphertext-3",
      iv: "iv-3",
      wrappedDEK: "wrapped-3",
      dekIv: "dekIv-3",
      keyVersion: 3,
      metadata: null,
      expiresAt: null,
    });

    const cleared = await t.query(api.lib.get, {
      namespace: "acme:production",
      name: "resend",
      now: Date.now(),
    });
    expect(cleared).toMatchObject({
      ok: true,
      keyVersion: 3,
    });
    if (cleared.ok) {
      expect(cleared.metadata).toBeUndefined();
      expect(cleared.expiresAt).toBeUndefined();
    }
  });

  test("listEvents rejects combining name and type filters", async () => {
    const t = initConvexTest();
    await expect(
      t.query(api.lib.listEvents, {
        namespace: "acme:production",
        name: "stripe",
        type: "created",
        paginationOpts: { numItems: 10, cursor: null },
      }),
    ).rejects.toThrow();
  });

  test("cleanup only removes expired secrets and leaves perpetual secrets intact", async () => {
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

    vi.setSystemTime(new Date("2026-03-07T00:00:05.000Z"));

    const cleanupResult = await t.mutation(api.lib.cleanup, {
      retentionMs: 24 * 60 * 60 * 1000,
      batchSize: 10,
    });

    expect(cleanupResult.deletedSecrets).toBe(1);

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

  test("updateWrappedDEK returns stale when the row changed after it was read", async () => {
    const t = initConvexTest();
    const created = await t.mutation(api.lib.put, {
      name: "stripe",
      encryptedValue: "ciphertext-1",
      iv: "iv-1",
      wrappedDEK: "wrapped-1",
      dekIv: "dekIv-1",
      keyVersion: 1,
    });

    await t.mutation(api.lib.put, {
      name: "stripe",
      encryptedValue: "ciphertext-2",
      iv: "iv-2",
      wrappedDEK: "wrapped-2",
      dekIv: "dekIv-2",
      keyVersion: 2,
    });

    const result = await t.mutation(api.lib.updateWrappedDEK, {
      secretId: created.secretId,
      expectedKeyVersion: 1,
      expectedUpdatedAt: created.updatedAt,
      wrappedDEK: "wrapped-rotated",
      dekIv: "dekIv-rotated",
      keyVersion: 3,
    });

    expect(result).toEqual({ ok: false, reason: "stale" });
  });
});
