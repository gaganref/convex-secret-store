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
});
