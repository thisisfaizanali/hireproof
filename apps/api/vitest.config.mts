import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["test/globalSetup.ts"],
    // Tests share one database, so files run one after another.
    fileParallelism: false,
  },
});
