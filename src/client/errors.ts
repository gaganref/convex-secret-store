import { ConvexError } from "convex/values";

/**
 * Stable error codes thrown by the secret store. Every secret-store failure is
 * a `ConvexError` whose `data` carries one of these codes.
 */
export type SecretStoreErrorCode =
  | "invalid_argument"
  | "invalid_keys"
  | "key_unavailable"
  | "decryption_failed"
  | "value_too_large"
  | "not_found"
  | "expired";

/** The structured `data` payload carried by every secret-store `ConvexError`. */
export type SecretStoreErrorData = {
  code: SecretStoreErrorCode;
  message: string;
};

const CODES: ReadonlySet<string> = new Set<SecretStoreErrorCode>([
  "invalid_argument",
  "invalid_keys",
  "key_unavailable",
  "decryption_failed",
  "value_too_large",
  "not_found",
  "expired",
]);

/**
 * Type guard for errors thrown by the secret store. Narrows to a `ConvexError`
 * whose `data` carries a typed {@link SecretStoreErrorCode}, so callers can
 * branch on `error.data.code`.
 */
export function isSecretStoreError(
  error: unknown,
): error is ConvexError<SecretStoreErrorData> {
  if (!(error instanceof ConvexError)) {
    return false;
  }
  const data = error.data as { code?: unknown } | null | undefined;
  return (
    typeof data === "object" &&
    data !== null &&
    typeof data.code === "string" &&
    CODES.has(data.code)
  );
}
