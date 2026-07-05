import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    benchmark: {
      include: ["test/bench/**/*.ts"],
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
    },
  },
});
