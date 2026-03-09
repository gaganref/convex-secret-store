import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { initConvexTest } from "./setup.test";
import { api } from "./_generated/api";

describe("example", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
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

  test("seedLegacySecret and runRotationBatch move a secret to the active version", async () => {
    const t = initConvexTest();
    await t.mutation(api.example.seedLegacySecret, {
      workspace: "acme",
      environment: "production",
      name: "JWT_SIGNING_KEY",
      value: "legacy-key-value",
    });

    const before = await t.query(api.example.getSettingsSnapshot, {
      workspace: "acme",
      environment: "production",
    });
    expect(before.versionCounts).toContainEqual({ keyVersion: 1, count: 1 });

    const rotated = await t.mutation(api.example.runRotationBatch, {
      fromVersion: 1,
      batchSize: 20,
      cursor: null,
    });
    expect(rotated.rotated).toBe(1);

    const after = await t.query(api.example.getSettingsSnapshot, {
      workspace: "acme",
      environment: "production",
    });
    expect(after.versionCounts).toContainEqual({ keyVersion: 2, count: 1 });
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
    expect(preview.maskedValue).toContain("\u2022");
    expect(preview.maskedValue).not.toContain("sk-live-secret-1234");
  });

  test("seedDemoData populates environment with sample secrets", async () => {
    const t = initConvexTest();
    const result = await t.mutation(api.example.seedDemoData, {
      workspace: "acme",
      environment: "development",
    });

    expect(result.seeded).toBe(6);

    const secrets = await t.query(api.example.listSecrets, {
      workspace: "acme",
      environment: "development",
      paginationOpts: { numItems: 20, cursor: null },
    });
    expect(secrets.page.length).toBe(6);

    // Re-seeding should not create duplicates
    const result2 = await t.mutation(api.example.seedDemoData, {
      workspace: "acme",
      environment: "development",
    });
    expect(result2.seeded).toBe(0);
  });
});
