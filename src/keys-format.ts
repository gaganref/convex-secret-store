/**
 * Pure validation and (de)serialization of the versioned key-encryption keys
 * carried in the `SECRET_STORE_KEYS` environment variable.
 *
 * Wire format: `version:value,version:value,...`
 * (e.g. `2:AgIC…,1:AQEB…`). Each value is a canonical 32-byte standard-base64
 * string — exactly 44 characters from `[A-Za-z0-9+/]` ending in one `=`, i.e.
 * the output of `openssl rand -base64 32`.
 *
 * Shared by `defineKeys` (host-side, in `convex.config.ts`) and the component's
 * runtime key loader. Throws a plain `Error` on any problem; the component
 * translates it into a `ConvexError` with code `invalid_keys`.
 */

import { decodeBase64 } from "./base64.js";

/** One versioned key-encryption key (KEK). */
export type KeyEntry = {
  /**
   * A stable, non-negative integer identifying this KEK. Bound into ciphertext;
   * never reuse or renumber a version once secrets exist under it.
   */
  version: number;
  /**
   * Canonical 32-byte standard-base64 key material: exactly 44 chars from
   * `[A-Za-z0-9+/]` followed by one `=` (the output of `openssl rand -base64 32`).
   */
  value: string;
};

const KEK_BYTE_LENGTH = 32;

/** Canonical 32-byte standard base64: 43 base64 chars + one `=` padding. */
const KEK_VALUE_RE = /^[A-Za-z0-9+/]{43}=$/;

function fail(message: string): never {
  throw new Error(`secret-store keys: ${message}`);
}

function validateKeyValue(value: string, label: string): void {
  if (value.length === 0) {
    fail(`${label} must not be empty`);
  }
  if (!KEK_VALUE_RE.test(value)) {
    if (value.length !== 44) {
      fail(
        `${label} must be exactly 44 base64 characters for a 32-byte key (got ${value.length})`,
      );
    }
    if (value[43] !== "=") {
      fail(`${label} must end with one '=' padding character`);
    }
    fail(`${label} contains a non-standard-base64 character`);
  }
  // The regex guarantees a 32-byte decode; this is belt-and-suspenders.
  let decoded: Uint8Array;
  try {
    decoded = decodeBase64(value);
  } catch {
    fail(`${label} is not valid base64`);
  }
  if (decoded.byteLength !== KEK_BYTE_LENGTH) {
    fail(
      `${label} must decode to exactly ${KEK_BYTE_LENGTH} bytes (got ${decoded.byteLength})`,
    );
  }
}

/**
 * Validate that `keys` form a well-formed key set: at least one entry, each
 * `version` a unique non-negative integer, each `value` a canonical 32-byte
 * standard-base64 string. Throws on any problem.
 */
export function validateKeyEntries(keys: readonly KeyEntry[]): void {
  if (!Array.isArray(keys) || keys.length === 0) {
    fail("at least one key is required");
  }

  const seen = new Set<number>();
  keys.forEach((entry, index) => {
    if (
      typeof entry !== "object" ||
      entry === null ||
      typeof entry.version !== "number" ||
      typeof entry.value !== "string"
    ) {
      fail(`keys[${index}] must be { version: number, value: string }`);
    }
    if (!Number.isInteger(entry.version) || entry.version < 0) {
      fail(`keys[${index}].version must be a non-negative integer`);
    }
    if (seen.has(entry.version)) {
      fail(`version ${entry.version} is duplicated`);
    }
    seen.add(entry.version);
    validateKeyValue(entry.value.trim(), `keys[${index}].value`);
  });
}

/**
 * Validate `keys` and serialize them into the delimited string stored in the
 * `SECRET_STORE_KEYS` environment variable. Duplicate version numbers are
 * caught by TypeScript at the call site (object literals reject duplicate
 * keys); other constraints are enforced at runtime.
 *
 * ```ts
 * app.use(secretStore, {
 *   env: {
 *     SECRET_STORE_KEYS: defineKeys({
 *       2: process.env.MY_APP_KEK_V2!,
 *       1: process.env.MY_APP_KEK_V1!,
 *     }),
 *   },
 * });
 * ```
 *
 * Operators who prefer to skip the helper can set the env var directly:
 * `convex env set SECRET_STORE_KEYS "1:AQEB…,2:AgIC…"`.
 */
export function defineKeys(keys: Record<number, string>): string {
  const entries: KeyEntry[] = Object.entries(keys).map(([k, value]) => {
    const version = Number(k);
    if (!Number.isInteger(version) || version < 0) {
      fail(`"${k}" is not a non-negative integer version`);
    }
    if (typeof value !== "string") {
      fail(`version ${k} value must be a string`);
    }
    return { version, value: value.trim() };
  });
  validateKeyEntries(entries);
  return entries
    .map((entry) => `${entry.version}:${entry.value}`)
    .join(",");
}

/** Parse and validate the `SECRET_STORE_KEYS` environment variable value. */
export function parseKeyEntries(raw: string): KeyEntry[] {
  if (raw.trim() === "") {
    fail("SECRET_STORE_KEYS is empty");
  }

  const entries: KeyEntry[] = raw.split(",").map((token, index) => {
    const trimmed = token.trim();
    if (trimmed.length === 0) {
      fail(`SECRET_STORE_KEYS entry ${index} is empty`);
    }
    const colon = trimmed.indexOf(":");
    if (colon < 0) {
      fail(
        `SECRET_STORE_KEYS entry ${index} must be "version:value", got "${trimmed}"`,
      );
    }
    const versionStr = trimmed.slice(0, colon).trim();
    const value = trimmed.slice(colon + 1).trim();
    const version = Number(versionStr);
    if (versionStr === "" || !Number.isInteger(version) || version < 0) {
      fail(
        `SECRET_STORE_KEYS entry ${index} version "${versionStr}" is not a non-negative integer`,
      );
    }
    return { version, value };
  });

  validateKeyEntries(entries);
  return entries;
}
