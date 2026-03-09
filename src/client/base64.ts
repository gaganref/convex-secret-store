import { invalidArgumentError, runtimeUnavailableError } from "./errors.js";

export function decodeBase64(input: string): Uint8Array {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4 || 4)) % 4),
    "=",
  );

  try {
    if (typeof atob === "function") {
      const decoded = atob(padded);
      return Uint8Array.from(decoded, (char) => char.charCodeAt(0));
    }
    if (typeof Buffer !== "undefined") {
      return Uint8Array.from(Buffer.from(padded, "base64"));
    }
  } catch (error) {
    throw invalidArgumentError(`invalid base64 data: ${String(error)}`);
  }

  throw runtimeUnavailableError("base64 decoding is unavailable");
}

export function encodeBase64(bytes: Uint8Array): string {
  if (typeof btoa === "function") {
    let binary = "";
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }
    return btoa(binary);
  }
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  throw runtimeUnavailableError("base64 encoding is unavailable");
}
