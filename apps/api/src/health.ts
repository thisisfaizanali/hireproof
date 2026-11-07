import { Router } from "express";
import type { HealthResponse } from "@hireproof/shared";
import { prisma } from "./db";

async function dbIsUp(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

export const health = Router();

health.get("/api/health", async (_req, res) => {
  const up = await dbIsUp();
  const body: HealthResponse = {
    status: "ok",
    db: up ? "up" : "down",
    time: new Date().toISOString(),
  };
  // A 503 tells the host not to send traffic here while the database is out.
  res
    .status(up ? 200 : 503)
    .set("Cache-Control", "no-store")
    .json(body);
});
