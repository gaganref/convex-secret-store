import { v } from "convex/values";

export const secretEventTypes = [
  "created",
  "updated",
  "deleted",
  "rotated",
] as const;

export type SecretEventType = (typeof secretEventTypes)[number];

export const metadataValidator = v.record(v.string(), v.any());

export const secretEventTypeValidator = v.union(
  v.literal("created"),
  v.literal("updated"),
  v.literal("deleted"),
  v.literal("rotated"),
);

export const orderValidator = v.optional(
  v.union(v.literal("asc"), v.literal("desc")),
);

export const effectiveStateValidator = v.union(
  v.literal("active"),
  v.literal("expired"),
);
