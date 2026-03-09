import { defineApp } from "convex/server";
import secretStore from "convex-secret-store/convex.config.js";

const app = defineApp();
app.use(secretStore);

export default app;
