import { defineComponent } from "convex/server";
import { v } from "convex/values";

/**
 * The secret store component.
 *
 * Declares the environment variables it requires. A host app supplies them at
 * mount time — `SECRET_STORE_KEYS` is required, so omitting it is a
 * compile-time error:
 *
 * ```ts
 * import secretStore from "convex-secret-store/convex.config";
 * import { defineKeys } from "convex-secret-store";
 *
 * app.use(secretStore, {
 *   env: {
 *     SECRET_STORE_KEYS: defineKeys({
 *       1: process.env.KEK_V1!,
 *     }),
 *   },
 * });
 * ```
 *
 * Note: a component's `convex.config.ts` may export only the `defineComponent`
 * result. `defineKeys` is therefore exported from the package's main entry.
 */
export default defineComponent("secretStore", {
  env: {
    SECRET_STORE_KEYS: v.string(),
    SECRET_STORE_DEFAULT_TTL_MS: v.optional(v.string()),
  },
});
