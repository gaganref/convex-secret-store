import { describe, expect, test } from "vitest";
import { resolveExpiresAt } from "./expiry.js";

describe("resolveExpiresAt", () => {
  test("uses ttlMs when given a number", () => {
    expect(resolveExpiresAt(1000, 5000, null)).toBe(6000);
  });

  test("returns undefined when ttlMs is null", () => {
    expect(resolveExpiresAt(1000, null, 5000)).toBeUndefined();
  });

  test("falls back to the default when ttlMs is omitted", () => {
    expect(resolveExpiresAt(1000, undefined, 5000)).toBe(6000);
  });

  test("returns undefined when ttlMs is omitted and no default is set", () => {
    expect(resolveExpiresAt(1000, undefined, null)).toBeUndefined();
  });

  test("ttlMs overrides a configured default", () => {
    expect(resolveExpiresAt(1000, 200, 5000)).toBe(1200);
  });

  test("ttlMs null overrides a configured default", () => {
    expect(resolveExpiresAt(1000, null, 5000)).toBeUndefined();
  });

  test("rejects a negative ttlMs", () => {
    expect(() => resolveExpiresAt(1000, -1, null)).toThrow();
  });

  test("rejects a non-integer ttlMs", () => {
    expect(() => resolveExpiresAt(1000, 1.5, null)).toThrow();
  });
});
