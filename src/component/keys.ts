/**
 * Runtime key configuration for the component.
 *
 * Reads the `SECRET_STORE_KEYS` (and optional `SECRET_STORE_DEFAULT_TTL_MS`)
 * environment variables — declared as typed component env vars in
 * `convex.config.ts` and populated by Convex into `process.env` — parses and
 * validates them, resolves the active key version (the highest configured
 * version), and imports and caches the KEK `CryptoKey`s. Configuration is
 * loaded lazily on first use so a misconfiguration surfaces as a `ConvexError`
 * at call time rather than at module load.
 */

import { ConvexError } from "convex/values";
import { parseKeyEntries, type KeyEntry } from "../keys-format.js";
import { importKey } from "./crypto.js";

type KeyConfig = {
  byVersion: Map<number, string>;
  activeVersion: number;
  defaultTtlMs: number | null;
};

let configCache: KeyConfig | undefined;
const kekCache = new Map<number, Promise<CryptoKey>>();

function parseDefaultTtlMs(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === "") {
    return null;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new ConvexError({
      code: "invalid_keys",
      message: `SECRET_STORE_DEFAULT_TTL_MS must be a non-negative integer, got "${raw}"`,
    });
  }
  return value;
}

function loadConfig(): KeyConfig {
  if (configCache !== undefined) {
    return configCache;
  }

  const rawKeys = process.env.SECRET_STORE_KEYS;
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
    defaultTtlMs: parseDefaultTtlMs(process.env.SECRET_STORE_DEFAULT_TTL_MS),
  };
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
    kekCache.set(version, imported);
  }
  return imported;
}

/** Clear cached key configuration. For tests and local hot-reload only. */
export function resetKeyConfig(): void {
  configCache = undefined;
  kekCache.clear();
}
