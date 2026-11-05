import bcrypt from "bcryptjs";
import { DEMO_USERS } from "@hireproof/shared";
import { prisma } from "../src/db";
import type { Industry } from "../src/generated/prisma/client";

const CLIENTS: { id: string; name: string; industry: Industry }[] = [
  { id: "client_kestrel", name: "Kestrel Infotech", industry: "IT_SERVICES" },
  {
    id: "client_sahyadri",
    name: "Sahyadri Finserv",
    industry: "BANKING_BACK_OFFICE",
  },
  { id: "client_marigold", name: "Marigold Retail", industry: "RETAIL" },
];

async function main() {
  const password = process.env.SEED_DEMO_PASSWORD;
  if (!password || password.length < 8) {
    throw new Error(
      "Set SEED_DEMO_PASSWORD (at least 8 characters) in .env before seeding.",
    );
  }
  const passwordHash = await bcrypt.hash(password, 10);

  for (const { id, ...data } of CLIENTS) {
    await prisma.client.upsert({
      where: { id },
      update: data,
      create: { id, ...data },
    });
  }

  for (const user of DEMO_USERS) {
    const clientId = CLIENTS.find((c) => c.name === user.client)?.id ?? null;
    const data = { name: user.name, role: user.role, clientId, passwordHash };
    await prisma.user.upsert({
      where: { email: user.email },
      update: data,
      create: { email: user.email, ...data },
    });
  }

  console.table(
    DEMO_USERS.map(({ email, role, client }) => ({
      email,
      role,
      client: client ?? "-",
    })),
  );
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
