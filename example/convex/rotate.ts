import { internalMutation } from "./_generated/server.js";
import { secrets } from "./lib/secretStore.js";

/**
 * Drive key rotation. Call this once after deploying a new KEK version — the
 * component drains the backlog in the background. Re-running it is safe.
 *
 * Wire it to a temporary cron, or invoke it manually from the dashboard.
 */
export const rotateSecretStore = internalMutation({
  handler: async (ctx) => {
    return await secrets.rotate(ctx);
  },
});
