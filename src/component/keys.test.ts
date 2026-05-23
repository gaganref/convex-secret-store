import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { defineKeys } from "../keys-format.js";
import {
  activeVersion,
  defaultTtlMs,
  getKEK,
  hasVersion,
  resetKeyConfig,
} from "./keys.js";

const RAW_V1 = Buffer.alloc(32, 1).toString("base64");
const RAW_V2 = Buffer.alloc(32, 2).toString("base64");

function clearEnv() {
  resetKeyConfig();
  delete process.env.SECRET_STORE_KEYS;
  delete process.env.SECRET_STORE_DEFAULT_TTL_MS;
}

beforeEach(clearEnv);
afterEach(clearEnv);

describe("component key configuration", () => {
  test("active version is the highest configured version", () => {
    process.env.SECRET_STORE_KEYS = defineKeys({
      1: RAW_V1,
      5: RAW_V2,
    });
    expect(activeVersion()).toBe(5);
  });

  test("hasVersion reflects configured versions", () => {
    process.env.SECRET_STORE_KEYS = defineKeys({ 3: RAW_V1 });
    expect(hasVersion(3)).toBe(true);
    expect(hasVersion(4)).toBe(false);
  });

  test("getKEK throws for an unconfigured version", () => {
    process.env.SECRET_STORE_KEYS = defineKeys({ 1: RAW_V1 });
    expect(() => getKEK(2)).toThrow();
  });

  test("getKEK imports a configured KEK", async () => {
    process.env.SECRET_STORE_KEYS = defineKeys({ 1: RAW_V1 });
    const kek = await getKEK(1);
    expect(kek).toBeDefined();
  });

  test("missing SECRET_STORE_KEYS throws", () => {
    expect(() => activeVersion()).toThrow();
  });

  test("malformed SECRET_STORE_KEYS throws", () => {
    process.env.SECRET_STORE_KEYS = "not json";
    expect(() => activeVersion()).toThrow();
  });

  test("defaultTtlMs parses a configured value", () => {
    process.env.SECRET_STORE_KEYS = defineKeys({ 1: RAW_V1 });
    process.env.SECRET_STORE_DEFAULT_TTL_MS = "60000";
    expect(defaultTtlMs()).toBe(60000);
  });

  test("defaultTtlMs is null when unset", () => {
    process.env.SECRET_STORE_KEYS = defineKeys({ 1: RAW_V1 });
    expect(defaultTtlMs()).toBeNull();
  });

  test("rejects a non-integer default TTL", () => {
    process.env.SECRET_STORE_KEYS = defineKeys({ 1: RAW_V1 });
    process.env.SECRET_STORE_DEFAULT_TTL_MS = "abc";
    expect(() => defaultTtlMs()).toThrow();
  });
});
