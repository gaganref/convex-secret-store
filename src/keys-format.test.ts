import { describe, expect, test } from "vitest";
import {
  defineKeys,
  parseKeyEntries,
  validateKeyEntries,
} from "./keys-format.js";

const RAW_V1 = Buffer.alloc(32, 1).toString("base64");
const RAW_V2 = Buffer.alloc(32, 2).toString("base64");

describe("keys-format", () => {
  test("defineKeys serializes a single key to the delimited format", () => {
    expect(defineKeys({ 1: RAW_V1 })).toBe(`1:${RAW_V1}`);
  });

  test("defineKeys serializes multiple keys in ascending version order", () => {
    const serialized = defineKeys({ 2: RAW_V2, 1: RAW_V1 });
    // Object key iteration over numeric keys sorts ascending in V8 / modern JS.
    expect(serialized).toBe(`1:${RAW_V1},2:${RAW_V2}`);
  });

  test("defineKeys output round-trips through parseKeyEntries", () => {
    const serialized = defineKeys({ 2: RAW_V2, 1: RAW_V1 });
    expect(parseKeyEntries(serialized)).toEqual([
      { version: 1, value: RAW_V1 },
      { version: 2, value: RAW_V2 },
    ]);
  });

  test("defineKeys rejects an empty key set", () => {
    expect(() => defineKeys({})).toThrow(/at least one key/);
  });

  test("rejects a value that's the wrong length", () => {
    const tooShort = RAW_V1.slice(0, -1);
    expect(() => defineKeys({ 1: tooShort })).toThrow(
      /must be exactly 44 base64 characters/,
    );
    const tooLong = `${RAW_V1}X`;
    expect(() => defineKeys({ 1: tooLong })).toThrow(
      /must be exactly 44 base64 characters/,
    );
  });

  test("rejects a value missing the '=' padding", () => {
    const noPadding = `${RAW_V1.slice(0, -1)}A`;
    expect(() => defineKeys({ 1: noPadding })).toThrow(
      /'=' padding/,
    );
  });

  test("rejects a value with a non-standard-base64 character", () => {
    // Replace a standard char with a url-safe '_' to keep length 44.
    const urlSafe = `${RAW_V1.slice(0, -2)}_=`;
    expect(() => defineKeys({ 1: urlSafe })).toThrow(
      /non-standard-base64 character/,
    );
  });

  test("validateKeyEntries rejects duplicate versions", () => {
    // TS catches the literal-duplicate case at compile time; this exercises
    // the runtime path (e.g. entries produced from parsing).
    expect(() =>
      validateKeyEntries([
        { version: 1, value: RAW_V1 },
        { version: 1, value: RAW_V2 },
      ]),
    ).toThrow(/duplicated/);
  });

  test("validateKeyEntries rejects a negative version", () => {
    expect(() =>
      validateKeyEntries([{ version: -1, value: RAW_V1 }]),
    ).toThrow(/non-negative integer/);
  });

  test("validateKeyEntries rejects a non-integer version", () => {
    expect(() =>
      validateKeyEntries([{ version: 1.5, value: RAW_V1 }]),
    ).toThrow(/non-negative integer/);
  });

  test("parseKeyEntries parses a single entry", () => {
    expect(parseKeyEntries(`1:${RAW_V1}`)).toEqual([
      { version: 1, value: RAW_V1 },
    ]);
  });

  test("parseKeyEntries parses multiple entries in any order", () => {
    expect(parseKeyEntries(`2:${RAW_V2},1:${RAW_V1}`)).toEqual([
      { version: 2, value: RAW_V2 },
      { version: 1, value: RAW_V1 },
    ]);
  });

  test("parseKeyEntries tolerates surrounding whitespace", () => {
    expect(parseKeyEntries(`  1:${RAW_V1} , 2:${RAW_V2}  `)).toEqual([
      { version: 1, value: RAW_V1 },
      { version: 2, value: RAW_V2 },
    ]);
  });

  test("parseKeyEntries rejects an empty string", () => {
    expect(() => parseKeyEntries("")).toThrow(/empty/);
  });

  test("parseKeyEntries rejects a token without a colon", () => {
    expect(() => parseKeyEntries(`1${RAW_V1}`)).toThrow(/"version:value"/);
  });

  test("parseKeyEntries rejects a non-integer version", () => {
    expect(() => parseKeyEntries(`abc:${RAW_V1}`)).toThrow(
      /non-negative integer/,
    );
  });

  test("parseKeyEntries rejects duplicate versions", () => {
    expect(() => parseKeyEntries(`1:${RAW_V1},1:${RAW_V2}`)).toThrow(
      /duplicated/,
    );
  });

  test("parseKeyEntries surfaces a value validation error per-entry", () => {
    const tooShort = RAW_V1.slice(0, -1);
    expect(() => parseKeyEntries(`1:${tooShort}`)).toThrow(
      /must be exactly 44 base64 characters/,
    );
  });
});
