import { defineConfig } from "prisma/config";

// The Prisma CLI does not read .env itself; the shared one lives at the repo root.
try {
  process.loadEnvFile("../../.env");
} catch {
  // No .env (CI sets the variables directly).
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations", seed: "tsx prisma/seed.ts" },
  datasource: { url: process.env["DATABASE_URL"] },
});
