import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { app } from "../src/app";
import { prisma } from "../src/db";
import { loginAs, resetDb } from "./helpers";

beforeEach(resetDb);

describe("GET /api/clients", () => {
  it("is 401 for anonymous requests", async () => {
    const res = await request(app).get("/api/clients");
    expect(res.status).toBe(401);
  });

  it.each(["RECRUITER", "DELIVERY_HEAD"] as const)(
    "lists clients for %s",
    async (role) => {
      const { cookie } = await loginAs(role);
      await prisma.client.create({
        data: { name: "Kestrel Infotech", industry: "IT_SERVICES" },
      });
      const res = await request(app).get("/api/clients").set("Cookie", cookie);
      expect(res.status).toBe(200);
      expect(res.body).toEqual([
        expect.objectContaining({
          name: "Kestrel Infotech",
          industry: "IT_SERVICES",
        }),
      ]);
    },
  );

  it("is 403 for a client hiring manager", async () => {
    const { cookie } = await loginAs("CLIENT_HM");
    const res = await request(app).get("/api/clients").set("Cookie", cookie);
    expect(res.status).toBe(403);
  });
});
