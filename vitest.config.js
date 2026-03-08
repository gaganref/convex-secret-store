import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "example/**/*.test.ts"],
    exclude: [".local/**", "dist/**"],
    environment: "edge-runtime",
    typecheck: {
      tsconfig: "./tsconfig.test.json",
    },
  },
});
