import bcrypt from "bcryptjs";
import request from "supertest";
import type { Role } from "@hireproof/shared";
import { app } from "../src/app";
import { prisma } from "../src/db";

export const PASSWORD = "correct-horse-1";
const passwordHash = bcrypt.hashSync(PASSWORD, 4);

export async function resetDb() {
  await prisma.$executeRaw`TRUNCATE "AuditEvent", "Session", "User", "Client" CASCADE`;
}

export async function createUser(role: Role) {
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
      passwordHash,
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
