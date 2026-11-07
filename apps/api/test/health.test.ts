import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { HealthResponse } from "@hireproof/shared";
import { app } from "../src/app";
import { prisma } from "../src/db";

describe("GET /api/health", () => {
  it("returns a body that matches the shared schema", async () => {
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(HealthResponse.safeParse(res.body).success).toBe(true);
    expect(res.body.db).toBe("up");
  });

  it("returns 503 when the database cannot be reached", async () => {
    const spy = vi
      .spyOn(prisma, "$queryRaw")
      .mockRejectedValueOnce(new Error("connection refused"));
    const res = await request(app).get("/api/health");
    spy.mockRestore();
    expect(res.status).toBe(503);
    expect(res.body.db).toBe("down");
  });
});

describe("unknown routes", () => {
  it("return a JSON 404", async () => {
    const res = await request(app).get("/api/nope");
    expect(res.status).toBe(404);
    expect(res.type).toBe("application/json");
    expect(res.body).toEqual({ error: "Not found" });
  });
});
