import { defineApp } from "convex/server";
import { v } from "convex/values";
import { defineKeys } from "../../src/keys-format.js";
import secretStore from "../../src/component/convex.config.js";

// Each KEK version is a validated app env var, set on the Convex deployment
// with `npx convex env set MY_APP_KEK_V<n> "<base64-32-byte-key>"`.
//
// - `defineApp({ env })` declares each as required → Convex's push-time
//   validation gives a clean "missing required env var" error if absent.
// - `process.env.MY_APP_KEK_V<n>` reads the *value* in `defineKeys` because
//   `app.env.X` is an `EnvRef` (by reference), not a value, and `defineKeys`
//   needs the actual key material to validate (32-byte base64) and serialize.
//
// To add a new version: declare it in the `env` block below, set it on the
// deployment, and add it to the `defineKeys` array.
const app = defineApp({
  env: {
    MY_APP_KEK_V1: v.string(),
    MY_APP_KEK_V2: v.string(),
  },
});

app.use(secretStore, {
  env: {
    SECRET_STORE_KEYS: defineKeys({
      1: process.env.MY_APP_KEK_V1!,
      2: process.env.MY_APP_KEK_V2!,
    }),
  },
});

export default app;
