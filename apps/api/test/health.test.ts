import request from "supertest";
import { describe, expect, it } from "vitest";
import { HealthResponse } from "@hireproof/shared";
import { app } from "../src/app";

describe("GET /api/health", () => {
  it("returns a body that matches the shared schema", async () => {
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(HealthResponse.safeParse(res.body).success).toBe(true);
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
