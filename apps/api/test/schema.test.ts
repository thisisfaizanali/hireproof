import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/db";
import { resetDb } from "./helpers";

beforeEach(resetDb);

const base = { name: "Test User", passwordHash: "x" };

describe("User constraints", () => {
  it("rejects a client hiring manager without a client", async () => {
    await expect(
      prisma.user.create({
        data: { ...base, email: "hm@example.test", role: "CLIENT_HM" },
      }),
    ).rejects.toThrow();
  });

  it("rejects a recruiter attached to a client", async () => {
    const client = await prisma.client.create({
      data: { name: "Test Client", industry: "RETAIL" },
    });
    await expect(
      prisma.user.create({
        data: {
          ...base,
          email: "rec@example.test",
          role: "RECRUITER",
          clientId: client.id,
        },
      }),
    ).rejects.toThrow();
  });

  it("rejects an email that is not lowercase", async () => {
    await expect(
      prisma.user.create({
        data: { ...base, email: "Rec@example.test", role: "RECRUITER" },
      }),
    ).rejects.toThrow();
  });
});
