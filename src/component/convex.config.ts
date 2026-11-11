import { defineComponent } from "convex/server";
import { v } from "convex/values";

/**
 * The secret store requires `SECRET_STORE_KEYS` at mount time.
 * Declare it on the app and bind `app.env.SECRET_STORE_KEYS` so changes through
 * `npx convex env set SECRET_STORE_KEYS` take effect without a code push.
 * The typed alternative, `defineKeys({ 1: process.env.KEK_V1! })` from the
 * package's main entry, validates and serializes values fixed at push time.
 *
 * ```ts
 * import { defineApp } from "convex/server";
 * import { v } from "convex/values";
 * import secretStore from "convex-secret-store/convex.config";
 *
 * const app = defineApp({ env: { SECRET_STORE_KEYS: v.string() } });
 * app.use(secretStore, {
 *   env: {
 *     SECRET_STORE_KEYS: app.env.SECRET_STORE_KEYS,
 *   },
 * });
 * export default app;
 * ```
 */
export default defineComponent("secretStore", {
  env: {
    SECRET_STORE_KEYS: v.string(),
    SECRET_STORE_DEFAULT_TTL_MS: v.optional(v.string()),
  },
});
