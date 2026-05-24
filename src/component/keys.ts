/**
 * Runtime key configuration for the component.
 *
 * Reads the `SECRET_STORE_KEYS` (and optional `SECRET_STORE_DEFAULT_TTL_MS`)
 * environment variables — declared as typed component env vars in
 * `convex.config.ts` and populated by Convex into `process.env` — parses and
 * validates them, resolves the active key version (the highest configured
 * version), and imports and caches the KEK `CryptoKey`s.
 *
 * Reads the values via the generated `env` import (the typed view of
 * `process.env` populated from `defineComponent({ env })`), so the required-
 * vs-optional shape is enforced by TypeScript and Convex's push-time check.
 *
 * The cache is keyed by the *raw env strings*: if either env var changes
 * underneath a warm runtime (operator runs `convex env set`), the next call
 * notices, reparses, and clears the imported-KEK cache. This is defensive —
 * Convex normally cycles isolates on env-var changes, but we don't want
 * correctness to depend on that.
 */

import { ConvexError } from "convex/values";
import { env } from "./_generated/server.js";
import { parseKeyEntries, type KeyEntry } from "../keys-format.js";
import { importKey } from "./crypto.js";

type KeyConfig = {
  byVersion: Map<number, string>;
  activeVersion: number;
  defaultTtlMs: number | null;
};

let configCache: KeyConfig | undefined;
let cachedRawKeys: string | undefined;
let cachedRawTtl: string | undefined;
const kekCache = new Map<number, Promise<CryptoKey>>();

function parseDefaultTtlMs(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === "") {
    return null;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new ConvexError({
      code: "invalid_keys",
      message: `SECRET_STORE_DEFAULT_TTL_MS must be a positive integer, got "${raw}"`,
    });
  }
  return value;
}

function loadConfig(): KeyConfig {
  // Convex validates `SECRET_STORE_KEYS` is present at push time via
  // `defineComponent({ env })`, but the validator still permits an empty
  // string; we treat empty as missing below.
  const rawKeys = env.SECRET_STORE_KEYS;
  const rawTtl = env.SECRET_STORE_DEFAULT_TTL_MS;

  if (
    configCache !== undefined &&
    rawKeys === cachedRawKeys &&
    rawTtl === cachedRawTtl
  ) {
    return configCache;
  }

  // Env changed — drop all cached state *before* any parsing. Invariant: the
  // caches either match the current env exactly, or are empty. We never want
  // them to reflect an older valid env while the current env is malformed.
  kekCache.clear();
  configCache = undefined;
  cachedRawKeys = undefined;
  cachedRawTtl = undefined;

  if (rawKeys === undefined || rawKeys.trim() === "") {
    throw new ConvexError({
      code: "invalid_keys",
      message: "SECRET_STORE_KEYS environment variable is not set",
    });
  }

  let entries: KeyEntry[];
  try {
    entries = parseKeyEntries(rawKeys);
  } catch (error) {
    throw new ConvexError({
      code: "invalid_keys",
      message: error instanceof Error ? error.message : String(error),
    });
  }

  configCache = {
    byVersion: new Map(entries.map((entry) => [entry.version, entry.value])),
    activeVersion: Math.max(...entries.map((entry) => entry.version)),
    defaultTtlMs: parseDefaultTtlMs(rawTtl),
  };
  cachedRawKeys = rawKeys;
  cachedRawTtl = rawTtl;
  return configCache;
}

/** The KEK version used to wrap DEKs for new writes — the highest configured. */
export function activeVersion(): number {
  return loadConfig().activeVersion;
}

/** The configured default secret TTL in milliseconds, or `null` if unset. */
export function defaultTtlMs(): number | null {
  return loadConfig().defaultTtlMs;
}

/** Whether a KEK for `version` is currently configured. */
export function hasVersion(version: number): boolean {
  return loadConfig().byVersion.has(version);
}

/**
 * Import (and cache) the KEK `CryptoKey` for `version`. Throws a `ConvexError`
 * with code `key_unavailable` when that version is not configured.
 */
export function getKEK(version: number): Promise<CryptoKey> {
  const config = loadConfig();
  const material = config.byVersion.get(version);
  if (material === undefined) {
    throw new ConvexError({
      code: "key_unavailable",
      message: `key version ${version} is not configured`,
    });
  }
  let imported = kekCache.get(version);
  if (imported === undefined) {
    imported = importKey(material);
    // Evict on rejection so a transient `importKey` failure doesn't poison the
    // cache. The original promise is still what we store and return — this
    // `.catch` is a side-channel that doesn't swallow the rejection.
    imported.catch(() => kekCache.delete(version));
    kekCache.set(version, imported);
  }
  return imported;
}

/** Clear cached key configuration. For tests and local hot-reload only. */
export function resetKeyConfig(): void {
  configCache = undefined;
  cachedRawKeys = undefined;
  cachedRawTtl = undefined;
  kekCache.clear();
}
