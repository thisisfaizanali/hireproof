import { Router } from "express";
import {
  DeleteCandidateInput,
  RETENTION_MONTHS,
  retainUntil,
  type DataPage,
} from "@hireproof/shared";
import { requireAuth, requireRole } from "./auth";
import { prisma } from "./db";
import { eraseCandidate } from "./erasure";
import { badInput } from "./http";

export const data = Router();

const deliveryHeadOnly = [requireAuth, requireRole("DELIVERY_HEAD")];

const RECENT_DELETIONS = 20;
const EXPIRED_LIMIT = 200;

data.get("/api/data/retention", ...deliveryHeadOnly, async (_req, res) => {
  const cutoff = new Date();
  cutoff.setUTCMonth(cutoff.getUTCMonth() - RETENTION_MONTHS);
  const [expired, expiredTotal, deletions] = await Promise.all([
    prisma.candidate.findMany({
      where: { lastActivityAt: { lt: cutoff } },
      orderBy: { lastActivityAt: "asc" },
      take: EXPIRED_LIMIT,
      select: { id: true, code: true, name: true, lastActivityAt: true },
    }),
    prisma.candidate.count({ where: { lastActivityAt: { lt: cutoff } } }),
    prisma.deletionRecord.findMany({
      orderBy: { deletedAt: "desc" },
      take: RECENT_DELETIONS,
      include: { deletedBy: { select: { name: true } } },
    }),
  ]);
  const body: DataPage = {
    expired: expired.map((c) => ({
      id: c.id,
      code: c.code,
      name: c.name,
      lastActivityAt: c.lastActivityAt.toISOString(),
      retainUntil: retainUntil(c.lastActivityAt).toISOString(),
    })),
    expiredTotal,
    deletions: deletions.map((d) => ({
      id: d.id,
      candidateCode: d.candidateCode,
      reason: d.reason,
      deletedBy: d.deletedBy.name,
      deletedAt: d.deletedAt.toISOString(),
      counts: d.counts as unknown as DataPage["deletions"][number]["counts"],
    })),
  };
  res.json(body);
});

// A JSON body on DELETE: the guard in app.ts lets it through because it is JSON.
data.delete("/api/candidates/:id", ...deliveryHeadOnly, async (req, res) => {
  const input = DeleteCandidateInput.safeParse(req.body);
  if (!input.success) return badInput(res, input.error);
  const candidate = await prisma.candidate.findUnique({
    where: { id: String(req.params.id) },
    select: { id: true, code: true },
  });
  if (!candidate) {
    res.status(404).json({ error: "Candidate not found" });
    return;
  }
  if (input.data.confirmCode.toUpperCase() !== candidate.code) {
    res.status(400).json({
      error: "That is not this candidate's code. Type it exactly as shown.",
      fields: { confirmCode: "That is not this candidate's code" },
    });
    return;
  }
  const counts = await eraseCandidate({
    candidateId: candidate.id,
    reason: input.data.reason,
    actorId: req.user!.id,
    ip: req.ip,
  });
  if (!counts) {
    res.status(404).json({ error: "Candidate not found" });
    return;
  }
  res.json({ code: candidate.code, counts });
});
