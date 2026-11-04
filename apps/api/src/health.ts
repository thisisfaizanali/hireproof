import { Router } from "express";
import { Client } from "pg";
import type { HealthResponse } from "@hireproof/shared";

async function dbIsUp(): Promise<boolean> {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 2000,
    query_timeout: 2000,
  });
  // A dropped connection emits an error event; without a listener it would crash the process.
  client.on("error", () => {});
  try {
    await client.connect();
    await client.query("SELECT 1");
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => {});
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
