import { defineApp } from "convex/server";
import secretStore from "../../src/component/convex.config.js";

const app = defineApp();
app.use(secretStore);

export default app;
