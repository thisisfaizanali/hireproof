import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseIst } from "@hireproof/shared";

// A client that reports every statement it sends, for this file only.
const log = vi.hoisted(() => ({ statements: 0 }));
vi.mock("../src/db", async () => {
  const { PrismaPg } = await import("@prisma/adapter-pg");
  const { PrismaClient } = await import("../src/generated/prisma/client");
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
    log: [{ emit: "event", level: "query" }],
  });
  prisma.$on("query", () => {
    log.statements++;
  });
  return { prisma };
});

import { prisma } from "../src/db";
import { weekInsights } from "../src/insights";
import { resetDb } from "./helpers";
import { candidateAt, createStaff, openRequisition } from "./pipelineHelpers";
import { createClient } from "./pipelineHelpers";

async function crowd(size: number) {
  const recruiter = await createStaff("RECRUITER", `r${size}@example.test`);
  const hm = await createClient(`Client ${size}`, `hm${size}@example.test`);
  const requisitions = [
    await openRequisition(hm.client.id, recruiter.user.id, "One"),
    await openRequisition(hm.client.id, recruiter.user.id, "Two"),
  ];
  for (let i = 0; i < size; i++) {
    const made = await candidateAt(
      requisitions[i % 2].id,
      recruiter.user.id,
      "SOURCED",
      `Person ${i}`,
    );
    await prisma.auditEvent.create({
      data: {
        actorId: recruiter.user.id,
        action: i % 3 === 0 ? "APPLICATION_REJECTED" : "APPLICATION_SCREENED",
        entityType: "Application",
        entityId: made.application.id,
        createdAt: parseIst("2026-11-03T10:00")!,
        meta: { band: "STRONG", total: 80 },
      },
    });
  }
}

async function statementsFor() {
  log.statements = 0;
  await weekInsights("2026-11-02", "2026-11-02");
  return log.statements;
}

describe("the insights endpoint", () => {
  beforeEach(resetDb);

  it("sends the same number of statements for 4 decisions as for 40", async () => {
    await crowd(4);
    const few = await statementsFor();
    await resetDb();
    await crowd(40);
    const many = await statementsFor();
    console.log(`insights statements: ${few} for 4 decisions, ${many} for 40`);
    expect(many).toBe(few);
    expect(many).toBeLessThanOrEqual(20);
  }, 60_000);
});
