import { v } from "convex/values";

/**
 * Plaintext metadata stored alongside a secret. Compile-time callers may
 * narrow this with the `SecretStore` generic; runtime storage stays freeform.
 */
export const metadataValidator = v.record(v.string(), v.any());

/** The kinds of audit events the store records. */
export const secretEventTypes = [
  "created",
  "updated",
  "deleted",
  "rotated",
] as const;

export type SecretEventType = (typeof secretEventTypes)[number];

export const secretEventTypeValidator = v.union(
  v.literal("created"),
  v.literal("updated"),
  v.literal("deleted"),
  v.literal("rotated"),
);

/** Optional ascending/descending order for paginated listings. */
export const orderValidator = v.optional(
  v.union(v.literal("asc"), v.literal("desc")),
);
