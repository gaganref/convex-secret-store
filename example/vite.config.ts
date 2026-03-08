import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
  envDir: "../",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
    conditions: ["@convex-dev/component-source"],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) {
            return undefined;
          }
          if (id.includes("/convex/")) {
            return "convex";
          }
          if (id.includes("@base-ui")) {
            return "base-ui";
          }
          if (id.includes("@phosphor-icons")) {
            return "icons";
          }
          if (
            id.includes("class-variance-authority") ||
            id.includes("clsx") ||
            id.includes("tailwind-merge")
          ) {
            return "ui-utils";
          }
          return "vendor";
        },
      },
    },
  },
});
