import { defineApp } from "convex/server";
import { v } from "convex/values";
import secretStore from "../../src/component/convex.config.js";

// Bind the comma-separated `version:value` map by reference so changes through
// `npx convex env set SECRET_STORE_KEYS` take effect without a push.
// The typed alternative, `defineKeys({ 1: process.env.MY_APP_KEK_V1! })` from
// "convex-secret-store", validates and serializes values fixed at push time.
const app = defineApp({
  env: {
    SECRET_STORE_KEYS: v.string(),
  },
});

app.use(secretStore, {
  env: {
    SECRET_STORE_KEYS: app.env.SECRET_STORE_KEYS,
  },
});

export default app;
