import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "example/**/*.test.ts"],
    exclude: [".local/**", "dist/**"],
    environment: "edge-runtime",
    typecheck: {
      tsconfig: "./tsconfig.test.json",
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: [
        "src/client/**/*.ts",
        "src/component/**/*.ts",
        "src/shared.ts",
        "example/convex/**/*.ts",
      ],
      exclude: [
        "src/**/*.test.ts",
        "src/**/setup.test.ts",
        "src/**/_generated/**",
        "src/test.ts",
        "src/react/**",
        "src/client/index.ts",
        "src/client/types.ts",
        "src/component/convex.config.ts",
        "src/component/schema.ts",
        "example/**/setup.test.ts",
        "example/**/_generated/**",
        "example/convex/convex.config.ts",
        "example/convex/schema.ts",
        "example/convex/http.ts",
      ],
    },
  },
});
