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

  test("upsertConnection stores a connection and records activity", async () => {
    const t = initConvexTest();
    const created = await t.mutation(api.example.upsertConnection, {
      workspace: "acme",
      environment: "production",
      provider: "openai",
      value: "sk-test",
      label: "Primary OpenAI key",
    });

    expect(created.secretId).toBeDefined();

    const connections = await t.query(api.example.listConnections, {
      workspace: "acme",
      environment: "production",
      paginationOpts: { numItems: 20, cursor: null },
    });
    expect(connections.page).toHaveLength(1);
    expect(connections.page[0]?.name).toBe("openai");
    expect(connections.page[0]?.metadata).toEqual({
      provider: "openai",
      label: "Primary OpenAI key",
    });

    const events = await t.query(api.example.listActivity, {
      workspace: "acme",
      environment: "production",
      paginationOpts: { numItems: 20, cursor: null },
    });
    expect(events.page[0]?.type).toBe("created");
  });

  test("updateConnection changes metadata without replacing the secret value", async () => {
    const t = initConvexTest();
    await t.mutation(api.example.upsertConnection, {
      workspace: "acme",
      environment: "testing",
      provider: "resend",
      value: "re_test",
      label: "Original",
    });

    const updated = await t.mutation(api.example.updateConnection, {
      workspace: "acme",
      environment: "testing",
      provider: "resend",
      label: "Updated label",
      owner: "platform",
      notes: "Rotates quarterly",
      expiresAt: null,
    });

    expect(updated.updated).toBe(true);

    const connections = await t.query(api.example.listConnections, {
      workspace: "acme",
      environment: "testing",
      paginationOpts: { numItems: 20, cursor: null },
    });
    expect(connections.page[0]?.metadata).toEqual({
      provider: "resend",
      label: "Updated label",
      owner: "platform",
      notes: "Rotates quarterly",
    });
  });

  test("seedLegacyConnection and runRotationBatch move a secret to the active version", async () => {
    const t = initConvexTest();
    await t.mutation(api.example.seedLegacyConnection, {
      workspace: "acme",
      environment: "production",
      provider: "stripe",
      value: "sk_live_legacy",
    });

    const before = await t.query(api.example.getMaintenanceSnapshot, {
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

    const after = await t.query(api.example.getMaintenanceSnapshot, {
      workspace: "acme",
      environment: "production",
    });
    expect(after.versionCounts).toContainEqual({ keyVersion: 2, count: 1 });
  });

  test("removeConnection deletes the secret", async () => {
    const t = initConvexTest();
    await t.mutation(api.example.upsertConnection, {
      workspace: "acme",
      environment: "testing",
      provider: "resend",
      value: "re_test",
    });

    const removed = await t.mutation(api.example.removeConnection, {
      workspace: "acme",
      environment: "testing",
      provider: "resend",
    });
    expect(removed.removed).toBe(true);

    const connections = await t.query(api.example.listConnections, {
      workspace: "acme",
      environment: "testing",
      paginationOpts: { numItems: 20, cursor: null },
    });
    expect(connections.page).toHaveLength(0);
  });

  test("getUsagePreview returns only masked server-side output", async () => {
    const t = initConvexTest();
    await t.mutation(api.example.upsertConnection, {
      workspace: "acme",
      environment: "production",
      provider: "openai",
      value: "sk-live-secret-1234",
      owner: "platform",
      label: "Primary OpenAI key",
    });

    const preview = await t.query(api.example.getUsagePreview, {
      workspace: "acme",
      environment: "production",
      provider: "openai",
    });

    expect(preview.resolution).toBe("active");
    expect(preview.networkSafe).toBe(true);
    expect(preview.maskedToken).toContain("••••");
    expect(preview.maskedToken).not.toContain("sk-live-secret-1234");
    expect(preview.authHeaderPreview).toMatch(/^Bearer /);
    expect(preview.owner).toBe("platform");
    expect(preview.label).toBe("Primary OpenAI key");
  });
});
