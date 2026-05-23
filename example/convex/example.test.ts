import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { initConvexTest } from "./setup.test";
import { api } from "./_generated/api";
import { defineKeys } from "../../src/client/index.js";
import { resetKeyConfig } from "../../src/component/keys.js";

const RAW_V1 = Buffer.alloc(32, 1).toString("base64");

describe("example app", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetKeyConfig();
    process.env.SECRET_STORE_KEYS = defineKeys({ 1: RAW_V1 });
  });

  afterEach(() => {
    vi.useRealTimers();
    resetKeyConfig();
    delete process.env.SECRET_STORE_KEYS;
  });

  test("putSecret stores a secret and records activity", async () => {
    const t = initConvexTest();
    const created = await t.mutation(api.example.putSecret, {
      workspace: "acme",
      environment: "production",
      name: "DATABASE_URL",
      value: "postgresql://user:pass@db.example.com:5432/myapp",
    });
    expect(created.secretId).toBeDefined();

    const secrets = await t.query(api.example.listSecrets, {
      workspace: "acme",
      environment: "production",
      paginationOpts: { numItems: 20, cursor: null },
    });
    expect(secrets.page).toHaveLength(1);
    expect(secrets.page[0]?.name).toBe("DATABASE_URL");

    const events = await t.query(api.example.listActivity, {
      workspace: "acme",
      environment: "production",
      paginationOpts: { numItems: 20, cursor: null },
    });
    expect(events.page[0]?.type).toBe("created");
  });

  test("removeSecret deletes the secret", async () => {
    const t = initConvexTest();
    await t.mutation(api.example.putSecret, {
      workspace: "acme",
      environment: "staging",
      name: "RESEND_API_KEY",
      value: "re_test",
    });

    const removed = await t.mutation(api.example.removeSecret, {
      workspace: "acme",
      environment: "staging",
      name: "RESEND_API_KEY",
    });
    expect(removed.removed).toBe(true);

    const secrets = await t.query(api.example.listSecrets, {
      workspace: "acme",
      environment: "staging",
      paginationOpts: { numItems: 20, cursor: null },
    });
    expect(secrets.page).toHaveLength(0);
  });

  test("previewSecret returns only masked server-side output", async () => {
    const t = initConvexTest();
    await t.mutation(api.example.putSecret, {
      workspace: "acme",
      environment: "production",
      name: "OPENAI_API_KEY",
      value: "sk-live-secret-1234",
    });

    const preview = await t.query(api.example.previewSecret, {
      workspace: "acme",
      environment: "production",
      name: "OPENAI_API_KEY",
    });
    expect(preview.resolution).toBe("active");
    expect(preview.maskedValue).toContain("•");
    expect(preview.maskedValue).not.toContain("sk-live-secret-1234");
  });

  test("seedDemoData populates the scope and is idempotent", async () => {
    const t = initConvexTest();
    const first = await t.mutation(api.example.seedDemoData, {
      workspace: "acme",
      environment: "development",
    });
    expect(first.seeded).toBe(5);

    const second = await t.mutation(api.example.seedDemoData, {
      workspace: "acme",
      environment: "development",
    });
    expect(second.seeded).toBe(0);
  });

  test("getSettingsSnapshot summarizes the scope", async () => {
    const t = initConvexTest();
    await t.mutation(api.example.seedDemoData, {
      workspace: "acme",
      environment: "production",
    });

    const snapshot = await t.query(api.example.getSettingsSnapshot, {
      workspace: "acme",
      environment: "production",
    });
    expect(snapshot.totalSecrets).toBe(5);
    expect(snapshot.expiredSecrets).toBe(0);
    expect(snapshot.rotationComplete).toBe(true);
    expect(snapshot.versionCounts).toContainEqual({ keyVersion: 1, count: 5 });
  });

  test("runRotation is a no-op when every secret is on the active key", async () => {
    const t = initConvexTest();
    await t.mutation(api.example.putSecret, {
      workspace: "acme",
      environment: "production",
      name: "k",
      value: "v",
    });
    const result = await t.mutation(api.example.runRotation, {});
    expect(result).toEqual({ rotated: 0, isDone: true });
  });

  test("runCleanup and runEventCleanup remove expired data", async () => {
    const t = initConvexTest();
    await t.mutation(api.example.putSecret, {
      workspace: "acme",
      environment: "production",
      name: "TEMP_SECRET",
      value: "temp-value",
      ttlMs: 1,
    });

    vi.setSystemTime(new Date("2030-01-01T00:00:00.000Z"));

    const secretCleanup = await t.mutation(api.example.runCleanup, {
      retentionMs: 24 * 60 * 60 * 1000,
    });
    expect(secretCleanup.deleted).toBe(1);

    const eventCleanup = await t.mutation(api.example.runEventCleanup, {
      retentionMs: 24 * 60 * 60 * 1000,
    });
    expect(eventCleanup.deleted).toBeGreaterThanOrEqual(1);
  });
});
