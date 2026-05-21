import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { metadataValidator, secretEventTypeValidator } from "../shared.js";

export const secretsFields = {
  namespace: v.optional(v.string()),
  name: v.string(),
  encryptedValue: v.string(),
  iv: v.string(),
  wrappedDEK: v.string(),
  dekIv: v.string(),
  keyVersion: v.number(),
  metadata: v.optional(metadataValidator),
  expiresAt: v.optional(v.number()),
  updatedAt: v.number(),
};

// Audit events are append-only; their timestamp is the document's
// `_creationTime`, so every index is implicitly chronological.
export const secretEventsFields = {
  secretId: v.id("secrets"),
  namespace: v.optional(v.string()),
  name: v.string(),
  type: secretEventTypeValidator,
  metadata: v.optional(metadataValidator),
};

export default defineSchema({
  secrets: defineTable(secretsFields)
    .index("by_namespace_and_name", ["namespace", "name"])
    .index("by_namespace_and_updated_at", ["namespace", "updatedAt"])
    .index("by_key_version", ["keyVersion"])
    .index("by_expires_at", ["expiresAt"]),

  secretEvents: defineTable(secretEventsFields)
    .index("by_secret_id", ["secretId"])
    .index("by_namespace", ["namespace"])
    .index("by_namespace_and_name", ["namespace", "name"])
    .index("by_namespace_and_type", ["namespace", "type"]),
});
