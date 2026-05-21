/**
 * Pure validation and (de)serialization of the versioned key-encryption keys
 * carried in the `SECRET_STORE_KEYS` environment variable.
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
  /** Base64-encoded 32-byte AES key material. */
  value: string;
};

const KEK_BYTE_LENGTH = 32;

function fail(message: string): never {
  throw new Error(`secret-store keys: ${message}`);
}

/**
 * Validate a list of versioned KEKs. Throws on an empty list, a non-integer or
 * negative version, a duplicate version, or material that does not decode to
 * exactly 32 bytes.
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
      fail(`keys[${index}].version ${entry.version} is duplicated`);
    }
    seen.add(entry.version);

    let decoded: Uint8Array;
    try {
      decoded = decodeBase64(entry.value.trim());
    } catch (error) {
      return fail(`keys[${index}].value is not valid base64: ${String(error)}`);
    }
    if (decoded.byteLength !== KEK_BYTE_LENGTH) {
      fail(`keys[${index}].value must decode to exactly ${KEK_BYTE_LENGTH} bytes`);
    }
  });
}

/**
 * Validate `keys` and serialize them into the JSON string stored in the
 * `SECRET_STORE_KEYS` environment variable. Use this in your app's
 * `convex.config.ts`:
 *
 * ```ts
 * app.use(secretStore, {
 *   env: {
 *     SECRET_STORE_KEYS: defineKeys([
 *       { version: 2, value: process.env.KEK_V2! },
 *       { version: 1, value: process.env.KEK_V1! },
 *     ]),
 *   },
 * });
 * ```
 */
export function defineKeys(keys: readonly KeyEntry[]): string {
  validateKeyEntries(keys);
  return JSON.stringify(
    keys.map((entry) => ({
      version: entry.version,
      value: entry.value.trim(),
    })),
  );
}

/** Parse and validate the `SECRET_STORE_KEYS` environment variable value. */
export function parseKeyEntries(raw: string): KeyEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    fail(`SECRET_STORE_KEYS is not valid JSON: ${String(error)}`);
  }
  if (!Array.isArray(parsed)) {
    fail("SECRET_STORE_KEYS must be a JSON array");
  }
  const keys = parsed as KeyEntry[];
  validateKeyEntries(keys);
  return keys.map((entry) => ({
    version: entry.version,
    value: entry.value.trim(),
  }));
}
