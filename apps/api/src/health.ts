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
  const body: HealthResponse = {
    status: "ok",
    db: (await dbIsUp()) ? "up" : "down",
    time: new Date().toISOString(),
  };
  res.json(body);
});
