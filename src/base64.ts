/**
 * Base64 / base64url codec shared by the component's crypto and the host-side
 * key validation. Throws a plain `Error` on failure; callers translate it into
 * a `ConvexError` with the appropriate code where needed.
 */

const UNAVAILABLE = "base64 codec is unavailable in this runtime";

export function decodeBase64(input: string): Uint8Array {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4 || 4)) % 4),
    "=",
  );

  try {
    if (typeof atob === "function") {
      return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
    }
    if (typeof Buffer !== "undefined") {
      return Uint8Array.from(Buffer.from(padded, "base64"));
    }
  } catch (error) {
    throw new Error(`invalid base64 input: ${String(error)}`);
  }

  throw new Error(UNAVAILABLE);
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
  throw new Error(UNAVAILABLE);
}
