import { v } from "convex/values";

/**
 * Plaintext metadata stored alongside a secret. Compile-time callers may
 * narrow this with the `SecretStore` generic; runtime storage stays freeform.
 */
export const metadataValidator = v.record(v.string(), v.any());
