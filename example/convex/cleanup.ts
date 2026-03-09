import { internalMutation } from "./_generated/server.js";
import { secrets } from "./lib/secretStore.js";

const SECRET_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const EVENT_RETENTION_MS = 180 * 24 * 60 * 60 * 1000;

export const cleanupSecrets = internalMutation({
  handler: async (ctx) => {
    return await secrets.cleanupSecrets(ctx, {
      retentionMs: SECRET_RETENTION_MS,
    });
  },
});

export const cleanupEvents = internalMutation({
  handler: async (ctx) => {
    return await secrets.cleanupEvents(ctx, {
      retentionMs: EVENT_RETENTION_MS,
    });
  },
});
