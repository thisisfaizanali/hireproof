import { execSync } from "node:child_process";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

// Tests run against their own database so they never touch development data.
// TEST_DATABASE_URL wins; otherwise the dev database name gets a _test suffix.
export default async function setup() {
  try {
    process.loadEnvFile("../../.env");
  } catch {
    // No .env file; CI sets the variables directly.
  }

  const testUrl = new URL(
    process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "",
  );
  if (!process.env.TEST_DATABASE_URL && !testUrl.pathname.endsWith("_test")) {
    testUrl.pathname += "_test";
  }
  const name = decodeURIComponent(testUrl.pathname.slice(1));
  if (!/^\w+$/.test(name))
    throw new Error(`Unsafe test database name: ${name}`);

  // CREATE DATABASE has to run from a different database, so use the default one.
  const adminUrl = new URL(testUrl);
  adminUrl.pathname = "/postgres";
  const admin = new PrismaClient({
    adapter: new PrismaPg({ connectionString: adminUrl.href }),
  });
  try {
    const found = await admin.$queryRaw<
      unknown[]
    >`SELECT 1 FROM pg_database WHERE datname = ${name}`;
    if (found.length === 0)
      await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.$disconnect();
  }

  process.env.DATABASE_URL = testUrl.href;
  execSync("npx prisma migrate deploy", { stdio: "pipe" });
}
