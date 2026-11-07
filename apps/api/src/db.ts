import { PrismaPg } from "@prisma/adapter-pg";
import { env } from "./env";
import { PrismaClient } from "./generated/prisma/client";

export const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: env.DATABASE_URL,
    // A database that scales to zero (Neon) needs a moment to wake.
    connectionTimeoutMillis: env.NODE_ENV === "production" ? 10_000 : 2000,
  }),
});
