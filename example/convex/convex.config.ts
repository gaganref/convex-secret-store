import { defineApp } from "convex/server";
import secretStore from "../../src/component/convex.config.js";
import { defineKeys } from "../../src/keys-format.js";

const app = defineApp();

// Demo-only fixed keys. Real apps load KEK material from environment variables
// and pass it via `defineKeys`.
app.use(secretStore, {
  env: {
    SECRET_STORE_KEYS: defineKeys([
      { version: 2, value: "key" },
      { version: 1, value: "key" },
    ]),
  },
});

export default app;
