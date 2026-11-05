import { Router } from "express";
import type { ClientSummary } from "@hireproof/shared";
import { requireAuth, requireRole } from "./auth";
import { prisma } from "./db";

export const clients = Router();

clients.get(
  "/api/clients",
  requireAuth,
  requireRole("RECRUITER", "DELIVERY_HEAD"),
  async (_req, res) => {
    const rows: ClientSummary[] = await prisma.client.findMany({
      select: { id: true, name: true, industry: true },
      orderBy: { name: "asc" },
    });
    res.json(rows);
  },
);
