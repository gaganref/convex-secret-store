import { describe, expect, test } from "vitest";
import {
  defineKeys,
  parseKeyEntries,
  validateKeyEntries,
} from "./keys-format.js";

const RAW_V1 = Buffer.alloc(32, 1).toString("base64");
const RAW_V2 = Buffer.alloc(32, 2).toString("base64");

describe("keys-format", () => {
  test("defineKeys serializes a valid key set", () => {
    const json = defineKeys([
      { version: 2, value: RAW_V2 },
      { version: 1, value: RAW_V1 },
    ]);
    expect(JSON.parse(json)).toEqual([
      { version: 2, value: RAW_V2 },
      { version: 1, value: RAW_V1 },
    ]);
  });

  test("defineKeys output round-trips through parseKeyEntries", () => {
    const json = defineKeys([{ version: 1, value: RAW_V1 }]);
    expect(parseKeyEntries(json)).toEqual([{ version: 1, value: RAW_V1 }]);
  });

  test("rejects an empty key list", () => {
    expect(() => validateKeyEntries([])).toThrow();
  });

  test("rejects a duplicate version", () => {
    expect(() =>
      validateKeyEntries([
        { version: 1, value: RAW_V1 },
        { version: 1, value: RAW_V2 },
      ]),
    ).toThrow(/duplicated/);
  });

  test("rejects a non-integer version", () => {
    expect(() =>
      validateKeyEntries([{ version: 1.5, value: RAW_V1 }]),
    ).toThrow();
  });

  test("rejects a negative version", () => {
    expect(() =>
      validateKeyEntries([{ version: -1, value: RAW_V1 }]),
    ).toThrow();
  });

  test("rejects material that does not decode to 32 bytes", () => {
    expect(() =>
      validateKeyEntries([
        { version: 1, value: Buffer.alloc(16, 1).toString("base64") },
      ]),
    ).toThrow(/32 bytes/);
  });

  test("parseKeyEntries rejects invalid JSON", () => {
    expect(() => parseKeyEntries("not json")).toThrow();
  });

  test("parseKeyEntries rejects a non-array", () => {
    expect(() => parseKeyEntries('{"version":1}')).toThrow();
  });
});
