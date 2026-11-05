import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["test/setup.ts"],
    // Tests share one database, so files run one after another.
    fileParallelism: false,
  },
});
