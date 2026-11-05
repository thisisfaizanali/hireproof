import bcrypt from "bcryptjs";
import request from "supertest";
import type { Role } from "@hireproof/shared";
import { app } from "../src/app";
import { prisma } from "../src/db";

export const PASSWORD = "correct-horse-1";
const hash = (password: string) => bcrypt.hashSync(password, 4);
const passwordHash = hash(PASSWORD);

export async function resetDb() {
  // Truncating is only safe on the dedicated test database.
  const dbName = new URL(process.env.DATABASE_URL ?? "").pathname;
  if (!dbName.endsWith("_test") && !process.env.TEST_DATABASE_URL) {
    throw new Error(`Refusing to truncate ${dbName}: not a test database`);
  }
  await prisma.$executeRaw`TRUNCATE "AuditEvent", "Session", "User", "Client" CASCADE`;
}

export async function createUser(role: Role, password?: string) {
  const client =
    role === "CLIENT_HM"
      ? await prisma.client.create({
          data: { name: "Test Client", industry: "RETAIL" },
        })
      : null;
  return prisma.user.create({
    data: {
      email: `${role.toLowerCase()}@example.test`,
      name: "Test User",
      role,
      passwordHash: password ? hash(password) : passwordHash,
      clientId: client?.id,
    },
  });
}

export async function loginAs(role: Role) {
  const user = await createUser(role);
  const res = await request(app)
    .post("/api/auth/login")
    .send({ email: user.email, password: PASSWORD });
  const cookie = (res.headers["set-cookie"] as unknown as string[])[0].split(
    ";",
  )[0];
  return { user, cookie };
}
