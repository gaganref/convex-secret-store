import { defineApp } from "convex/server";
import secretStore from "@gaganref/convex-secret-store/convex.config.js";

const app = defineApp();
app.use(secretStore);

export default app;
