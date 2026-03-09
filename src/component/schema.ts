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

export const secretEventsFields = {
  secretId: v.id("secrets"),
  namespace: v.optional(v.string()),
  name: v.string(),
  type: secretEventTypeValidator,
  metadata: v.optional(metadataValidator),
  createdAt: v.number(),
};

export default defineSchema({
  secrets: defineTable(secretsFields)
    .index("by_namespace_and_name", ["namespace", "name"])
    .index("by_namespace_and_updated_at", ["namespace", "updatedAt"])
    .index("by_key_version", ["keyVersion"])
    .index("by_expires_at", ["expiresAt"]),

  secretEvents: defineTable(secretEventsFields)
    .index("by_secret_id_and_created_at", ["secretId", "createdAt"])
    .index("by_namespace_and_created_at", ["namespace", "createdAt"])
    .index("by_namespace_and_name_and_created_at", [
      "namespace",
      "name",
      "createdAt",
    ])
    .index("by_namespace_and_type_and_created_at", [
      "namespace",
      "type",
      "createdAt",
    ])
    .index("by_created_at", ["createdAt"]),
});
