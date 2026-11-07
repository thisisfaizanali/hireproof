import type { ScoreSource } from "@hireproof/shared";
import { prisma } from "../db";
import type { Prisma } from "../generated/prisma/client";
import { aiScore, type AskScore } from "./ai";
import { computeScore } from "./compute";
import { verifyEvidence } from "./evidence";
import { rulesScore } from "./rules";
import { SCORABLE, queueScoring } from "./trigger";

export interface ScoreDeps {
  ai: AskScore;
}

const defaultDeps: ScoreDeps = {
  ai: (criteria, text) => aiScore(criteria, text),
};

// The CV a candidate is judged on is their newest one that has text.
export const scorableCv = (candidateId: string) =>
  prisma.cvDocument.findFirst({
    where: {
      candidateId,
      redactedText: { not: null },
      status: { in: [...SCORABLE] },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, redactedText: true },
  });

// The CV a candidate is read and screened on: the scored one, or failing that
// the newest file.
export async function currentCv(candidateId: string) {
  return (
    (await scorableCv(candidateId)) ??
    prisma.cvDocument.findFirst({
      where: { candidateId },
      orderBy: { createdAt: "desc" },
      select: { id: true, redactedText: true },
    })
  );
}

const num = (d: Prisma.Decimal | null) => (d === null ? null : Number(d));

export async function processScore(
  applicationId: string,
  deps: ScoreDeps = defaultDeps,
  force = false,
) {
  const app = await prisma.application.findUnique({
    where: { id: applicationId },
    include: {
      candidate: true,
      requisition: {
        include: {
          scorecard: {
            include: { criteria: { orderBy: { position: "asc" } } },
          },
        },
      },
    },
  });
  const card = app?.requisition.scorecard;
  if (!app || !card || card.status !== "CONFIRMED") return;
  const cv = await scorableCv(app.candidateId);
  if (!cv?.redactedText) return;

  const version = card.version;
  if (!force) {
    const done = await prisma.candidateScore.findUnique({
      where: {
        applicationId_scorecardVersion: {
          applicationId,
          scorecardVersion: version,
        },
      },
      select: { id: true },
    });
    if (done) return;
  }

  const started = await prisma.application.updateMany({
    where: { id: applicationId },
    data: { scoringStartedAt: new Date() },
  });
  // Erased since it was read.
  if (started.count === 0) return;
  try {
    const criteria = card.criteria.map((c) => ({
      id: c.id,
      label: c.label,
      kind: c.kind,
    }));
    const ai =
      criteria.length > 0
        ? await deps.ai(criteria, cv.redactedText)
        : { verdicts: null, run: null };
    const source: ScoreSource = ai.verdicts ? "AI" : "RULES";
    const verdicts = verifyEvidence(
      criteria,
      ai.verdicts ?? rulesScore(criteria, cv.redactedText),
      cv.redactedText,
    );
    const computed = computeScore(
      card,
      verdicts,
      {
        totalExperienceYears: num(app.candidate.totalExperienceYears),
        noticeDays: app.candidate.noticeDays,
        expectedCtcLpa: num(app.candidate.expectedCtcLpa),
        location: app.candidate.location,
      },
      source,
    );

    const requeue = await prisma.$transaction(async (tx) => {
      if (ai.run) {
        await tx.aiRun.create({
          data: {
            kind: "CV_SCORE",
            requisitionId: app.requisitionId,
            ...ai.run,
          },
        });
      }
      // The candidate may have been erased while the model worked.
      const alive = await tx.application.count({
        where: { id: applicationId },
      });
      if (alive === 0) return false;
      // The scorecard may have been confirmed again while the model worked.
      // A score for an old version is never stored; the new version has its
      // own job.
      const live = await tx.scorecard.findUnique({
        where: { id: card.id },
        select: { version: true, status: true },
      });
      if (live?.status !== "CONFIRMED" || live.version !== version) {
        return live?.status === "CONFIRMED";
      }
      const data = {
        total: computed.total,
        band: computed.band,
        mustHavesMet: computed.mustHavesMet,
        mustHavesTotal: computed.mustHavesTotal,
        experiencePoints: computed.experiencePoints,
        criteria: computed.criteria as unknown as Prisma.InputJsonValue,
        flags: computed.flags,
        source,
        model: source === "AI" ? ai.run!.model : null,
        stale: false,
        createdAt: new Date(),
      };
      await tx.candidateScore.upsert({
        where: {
          applicationId_scorecardVersion: {
            applicationId,
            scorecardVersion: version,
          },
        },
        create: { applicationId, scorecardVersion: version, ...data },
        update: data,
      });
      return false;
    });
    if (requeue) await queueScoring([applicationId]);
  } finally {
    await prisma.application.updateMany({
      where: { id: applicationId },
      data: { scoringStartedAt: null },
    });
  }
}

// After a restart, applications left mid-score go back in the queue.
export async function stuckScoreIds() {
  const stuck = await prisma.application.findMany({
    where: { scoringStartedAt: { not: null } },
    select: { id: true },
  });
  if (stuck.length > 0) {
    await prisma.application.updateMany({
      where: { id: { in: stuck.map((a) => a.id) } },
      data: { scoringStartedAt: null },
    });
  }
  return stuck.map((a) => a.id);
}
