import { optionsError } from "./errors.js";
import type { SecretStoreTypeOptions } from "./types.js";

export type SecretStoreOptions<
  TOptions extends SecretStoreTypeOptions = Record<never, never>,
> = {
  keys: Array<{ version: number; value: string }>;
  defaults?: {
    ttlMs?: number | null;
  };
  logLevel?: "debug" | "warn" | "error" | "none";
  _types?: TOptions | undefined;
};

export type NormalizedSecretStoreOptions = {
  keys: Array<{ version: number; value: string }>;
  activeVersion: number;
  keyVersions: Map<number, string>;
  defaults: { ttlMs: number | null };
  logLevel: "debug" | "warn" | "error" | "none";
};

const LOG_LEVELS = ["debug", "warn", "error", "none"] as const;
const DEFAULT_TTL_MS = null as number | null;

function decodeBase64Key(value: string): Uint8Array {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw optionsError("keys[].value must not be empty");
  }

  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4 || 4)) % 4),
    "=",
  );

  try {
    if (typeof atob === "function") {
      const decoded = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
      return Uint8Array.from(decoded, (char) => char.charCodeAt(0));
    }
    if (typeof Buffer !== "undefined") {
      return Uint8Array.from(Buffer.from(padded, "base64"));
    }
  } catch (error) {
    throw optionsError(
      `keys[].value must be valid base64-encoded key material: ${String(error)}`,
    );
  }

  throw optionsError("unable to decode base64 key material in this runtime");
}

function normalizeLogLevel(
  level: "debug" | "warn" | "error" | "none" | undefined,
): "debug" | "warn" | "error" | "none" {
  const resolved = level ?? "warn";
  if (!LOG_LEVELS.includes(resolved)) {
    throw optionsError(`logLevel must be one of: ${LOG_LEVELS.join(", ")}`);
  }
  return resolved;
}

export function assertNullableNonNegativeInteger(
  value: number | null | undefined,
  path: string,
) {
  if (value === undefined || value === null) {
    return;
  }
  if (!Number.isInteger(value) || value < 0) {
    throw optionsError(`${path} must be null or a non-negative integer`);
  }
}

export function normalizeSecretStoreOptions(
  options: SecretStoreOptions<SecretStoreTypeOptions>,
): NormalizedSecretStoreOptions {
  if (options.keys.length === 0) {
    throw optionsError("keys must contain at least one entry");
  }

  const seen = new Set<number>();
  const keys = options.keys.map((entry, index) => {
    if (!Number.isInteger(entry.version) || entry.version < 0) {
      throw optionsError(
        `keys[${index}].version must be a non-negative integer`,
      );
    }
    if (seen.has(entry.version)) {
      throw optionsError(
        `keys[${index}].version ${entry.version} is duplicated`,
      );
    }
    seen.add(entry.version);

    const decoded = decodeBase64Key(entry.value);
    if (decoded.byteLength !== 32) {
      throw optionsError(
        `keys[${index}].value must decode to exactly 32 bytes`,
      );
    }

    return {
      version: entry.version,
      value: entry.value.trim(),
    };
  });

  const defaults = {
    ttlMs: options.defaults?.ttlMs ?? DEFAULT_TTL_MS,
  };
  assertNullableNonNegativeInteger(defaults.ttlMs, "defaults.ttlMs");

  return {
    keys,
    activeVersion: keys[0].version,
    keyVersions: new Map(keys.map((entry) => [entry.version, entry.value])),
    defaults,
    logLevel: normalizeLogLevel(options.logLevel),
  };
}
