import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { metadataValidator } from "../shared.js";

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

export default defineSchema({
  secrets: defineTable(secretsFields)
    .index("by_namespace_and_name", ["namespace", "name"])
    .index("by_namespace_and_updated_at", ["namespace", "updatedAt"])
    .index("by_key_version", ["keyVersion"])
    .index("by_expires_at", ["expiresAt"]),
});
