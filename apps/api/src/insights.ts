import { Router } from "express";
import { z } from "zod";
import {
  DECISION_ACTIONS,
  REJECT_REASONS,
  SampleReviewInput,
  WeekStart,
  clientRejectLabel,
  weekRange,
  weekStartOf,
  type AiHealth,
  type CriterionScore,
  type DecisionAction,
  type Disagreement,
  type Funnel,
  type Overlap,
  type SampleItem,
  type SampleVerdict,
  type WeekInsights,
} from "@hireproof/shared";
import { audit } from "./audit";
import { requireAuth, requireRole } from "./auth";
import { prisma } from "./db";
import type { Prisma } from "./generated/prisma/client";
import { badInput } from "./http";
import {
  agreementTable,
  agrees,
  disagrees,
  overlap,
  pickSample,
  type Decision,
  type RankedApplication,
} from "./insightsCalc";
import { SCORABLE } from "./score/trigger";

export const insights = Router();

const deliveryHeadOnly = [requireAuth, requireRole("DELIVERY_HEAD")];

const isDecision = (action: string): action is DecisionAction =>
  (DECISION_ACTIONS as readonly string[]).includes(action);

const metaOf = (meta: Prisma.JsonValue): Record<string, unknown> =>
  meta && typeof meta === "object" && !Array.isArray(meta) ? meta : {};

const BANDS = ["STRONG", "POSSIBLE", "WEAK"] as const;

interface Row extends Decision {
  actorId: string | null;
  total: number | null;
  reason: string | null;
}

function toRow(e: {
  action: string;
  entityId: string | null;
  actorId: string | null;
  meta: Prisma.JsonValue;
  createdAt: Date;
}): Row | null {
  if (!isDecision(e.action) || !e.entityId) return null;
  const meta = metaOf(e.meta);
  const band = BANDS.find((b) => b === meta.band) ?? "NOT_SCORED";
  const code = typeof meta.reason === "string" ? meta.reason : null;
  const reason =
    e.action === "APPLICATION_REJECTED"
      ? (REJECT_REASONS.find(([v]) => v === code)?.[1] ?? null)
      : e.action === "CLIENT_REJECTED" && code
        ? clientRejectLabel(code as never)
        : null;
  return {
    applicationId: e.entityId,
    action: e.action,
    band,
    at: e.createdAt,
    actorId: e.actorId,
    total: typeof meta.total === "number" ? meta.total : null,
    reason,
  };
}

const dayOf = (weekStart: string) => new Date(`${weekStart}T00:00:00Z`);

// The decisions of a week, who made them, and the sample drawn from them.
// Both the page and the review endpoint read the sample from here, so what is
// shown and what may be reviewed cannot differ.
async function gather(weekStart: string) {
  const { from, to } = weekRange(weekStart);
  const events = await prisma.auditEvent.findMany({
    where: {
      action: { in: [...DECISION_ACTIONS, "STAGE_CHANGED"] },
      createdAt: { gte: from, lt: to },
    },
    orderBy: { createdAt: "asc" },
    select: {
      action: true,
      entityId: true,
      actorId: true,
      meta: true,
      createdAt: true,
    },
  });
  const rows = events.flatMap((e) => toRow(e) ?? []);
  const [apps, people, reviews, tally] = await Promise.all([
    prisma.application.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.applicationId))] } },
      select: {
        id: true,
        candidateId: true,
        candidate: { select: { code: true } },
        requisition: {
          select: {
            id: true,
            number: true,
            title: true,
            scorecard: { select: { version: true } },
          },
        },
      },
    }),
    prisma.user.findMany({
      where: {
        id: {
          in: [...new Set(rows.flatMap((r) => (r.actorId ? [r.actorId] : [])))],
        },
      },
      select: { id: true, name: true },
    }),
    prisma.sampleReview.findMany({ where: { weekStart: dayOf(weekStart) } }),
    prisma.sampleReview.groupBy({ by: ["verdict"], _count: true }),
  ]);
  const appById = new Map(apps.map((a) => [a.id, a]));
  const nameById = new Map(people.map((p) => [p.id, p.name]));

  // One entry per application: its latest disagreeing decision, or failing
  // that its latest agreeing one.
  const disagreementPool: Row[] = [];
  const agreementPool: Row[] = [];
  const perApp = new Map<string, Row[]>();
  for (const r of rows) {
    if (appById.has(r.applicationId)) {
      perApp.set(r.applicationId, [...(perApp.get(r.applicationId) ?? []), r]);
    }
  }
  for (const list of perApp.values()) {
    const dis = list.findLast(disagrees);
    const agr = list.findLast(agrees);
    if (dis) disagreementPool.push(dis);
    else if (agr) agreementPool.push(agr);
  }

  const reviewByApp = new Map(
    reviews.flatMap((r) => (r.applicationId ? [[r.applicationId, r]] : [])),
  );
  const picked = pickSample(
    weekStart,
    disagreementPool,
    agreementPool,
    new Set(reviewByApp.keys()),
  );
  return {
    from,
    to,
    events,
    rows,
    appById,
    nameById,
    disagreementPool,
    picked,
    reviewByApp,
    tally,
  };
}

type Gathered = Awaited<ReturnType<typeof gather>>;

// The newest CV that was read for each candidate, for the viewer links.
async function cvIdsFor(candidateIds: string[]) {
  const cvs = await prisma.cvDocument.findMany({
    where: {
      candidateId: { in: candidateIds },
      redactedText: { not: null },
      status: { in: [...SCORABLE] },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, candidateId: true },
  });
  const byCandidate = new Map<string, string>();
  for (const cv of cvs) {
    if (cv.candidateId && !byCandidate.has(cv.candidateId)) {
      byCandidate.set(cv.candidateId, cv.id);
    }
  }
  return byCandidate;
}

const sampleItem = (g: Gathered, r: Row, disagreement: boolean): SampleItem => {
  const app = g.appById.get(r.applicationId)!;
  const review = g.reviewByApp.get(r.applicationId);
  return {
    applicationId: r.applicationId,
    candidateId: app.candidateId,
    candidateCode: app.candidate.code,
    requisitionId: app.requisition.id,
    requisitionNumber: app.requisition.number,
    band: r.band as SampleItem["band"],
    total: r.total,
    action: r.action,
    reason: r.reason,
    disagreement,
    cvId: null,
    review: review ? { verdict: review.verdict, note: review.note } : null,
  };
};

async function aiHealth(from: Date, to: Date): Promise<AiHealth> {
  const week = { gte: from, lt: to };
  const [scores, runs, flagged] = await Promise.all([
    prisma.candidateScore.findMany({
      where: { createdAt: week },
      select: { source: true, criteria: true },
    }),
    prisma.aiRun.groupBy({
      by: ["kind", "outcome"],
      where: { createdAt: week },
      _count: true,
      _sum: { inputTokens: true, outputTokens: true },
    }),
    prisma.cvDocument.findMany({
      where: { createdAt: week, NOT: { reviewReasons: { isEmpty: true } } },
      select: { reviewReasons: true },
    }),
  ]);
  const quotes = { total: 0, verified: 0 };
  let downgrades = 0;
  for (const score of scores) {
    if (score.source !== "AI") continue;
    for (const c of score.criteria as unknown as CriterionScore[]) {
      if (c.flag) downgrades++;
      for (const q of c.quotes) {
        quotes.total++;
        if (q.verified) quotes.verified++;
      }
    }
  }
  return {
    scoresBySource: {
      AI: scores.filter((s) => s.source === "AI").length,
      RULES: scores.filter((s) => s.source === "RULES").length,
    },
    runs: runs.map((r) => ({
      kind: r.kind,
      outcome: r.outcome,
      count: r._count,
    })),
    inputTokens: runs.reduce((n, r) => n + (r._sum.inputTokens ?? 0), 0),
    outputTokens: runs.reduce((n, r) => n + (r._sum.outputTokens ?? 0), 0),
    quotes,
    downgrades,
    reviewReasons: flagged.reduce((n, c) => n + c.reviewReasons.length, 0),
  };
}

// Of the AI's ten best at the end of the week, how many were screened, and
// which screened candidates it ranked lower. Ranks use the scores on file now.
async function overlaps(g: Gathered): Promise<Overlap[]> {
  const requisitions = new Map<
    string,
    { number: number; title: string; version: number | null }
  >();
  for (const r of g.rows) {
    if (
      r.action !== "APPLICATION_SCREENED" &&
      r.action !== "APPLICATION_REJECTED"
    ) {
      continue;
    }
    const q = g.appById.get(r.applicationId)?.requisition;
    if (q) {
      requisitions.set(q.id, {
        number: q.number,
        title: q.title,
        version: q.scorecard?.version ?? null,
      });
    }
  }
  if (requisitions.size === 0) return [];

  const apps = await prisma.application.findMany({
    where: {
      requisitionId: { in: [...requisitions.keys()] },
      createdAt: { lt: g.to },
    },
    select: {
      id: true,
      requisitionId: true,
      candidateId: true,
      candidate: { select: { code: true } },
      scores: {
        select: {
          scorecardVersion: true,
          band: true,
          total: true,
          mustHavesMet: true,
        },
      },
    },
  });
  const screenedEvents = await prisma.auditEvent.findMany({
    where: {
      action: "APPLICATION_SCREENED",
      createdAt: { lt: g.to },
      entityId: { in: apps.map((a) => a.id) },
    },
    select: { entityId: true },
  });
  const screened = new Set(screenedEvents.map((e) => e.entityId!));

  return [...requisitions.entries()]
    .sort((a, b) => a[1].number - b[1].number)
    .map(([id, q]) => {
      const ranked: RankedApplication[] = apps
        .filter((a) => a.requisitionId === id)
        .map((a) => ({
          id: a.id,
          candidateId: a.candidateId,
          code: a.candidate.code,
          score: a.scores.find((s) => s.scorecardVersion === q.version) ?? null,
        }));
      return {
        requisitionId: id,
        number: q.number,
        title: q.title,
        ...overlap(ranked, screened),
      };
    });
}

function funnel(g: Gathered, sourced: number): Funnel {
  const count = (action: DecisionAction) =>
    g.events.filter((e) => e.action === action).length;
  const moved = (to: string) =>
    g.events.filter(
      (e) => e.action === "STAGE_CHANGED" && metaOf(e.meta).to === to,
    ).length;
  return {
    sourced,
    screened: count("APPLICATION_SCREENED"),
    submitted: count("APPLICATION_SUBMITTED"),
    shortlisted: count("CLIENT_SHORTLISTED"),
    interview: moved("INTERVIEW"),
    offered: moved("OFFERED"),
    joined: moved("JOINED"),
  };
}

// A fixed set of queries however many decisions the week holds: nothing is
// fetched per application. test/insightsQueries.test.ts holds that to account.
export async function weekInsights(
  weekStart: string,
  thisWeek: string,
): Promise<WeekInsights> {
  const g = await gather(weekStart);
  const disagreements: Disagreement[] = g.disagreementPool.flatMap((r) => {
    const item = sampleItem(g, r, true);
    return {
      applicationId: item.applicationId,
      candidateId: item.candidateId,
      candidateCode: item.candidateCode,
      requisitionId: item.requisitionId,
      requisitionNumber: item.requisitionNumber,
      band: item.band,
      total: r.total,
      action: r.action,
      reason: r.reason,
      by: (r.actorId && g.nameById.get(r.actorId)) || "A user",
      at: r.at.toISOString(),
      cvId: null,
    };
  });
  disagreements.sort((a, b) => b.at.localeCompare(a.at));

  const items = g.picked.map(({ item, disagreement }) =>
    sampleItem(g, item, disagreement),
  );
  const [cvs, health, overlapRows, sourced] = await Promise.all([
    cvIdsFor([
      ...new Set([...disagreements, ...items].map((x) => x.candidateId)),
    ]),
    aiHealth(g.from, g.to),
    overlaps(g),
    prisma.application.count({
      where: { createdAt: { gte: g.from, lt: g.to } },
    }),
  ]);
  for (const d of disagreements) d.cvId = cvs.get(d.candidateId) ?? null;
  for (const i of items) i.cvId = cvs.get(i.candidateId) ?? null;

  const tally: Record<SampleVerdict, number> = {
    AI_RIGHT: 0,
    RECRUITER_RIGHT: 0,
    BOTH_REASONABLE: 0,
  };
  for (const t of g.tally) tally[t.verdict] = t._count;

  return {
    weekStart,
    thisWeek,
    agreement: agreementTable(g.rows),
    disagreements,
    sample: {
      items,
      reviewed: items.filter((i) => i.review).length,
      tally,
    },
    overlap: overlapRows,
    health,
    funnel: funnel(g, sourced),
  };
}

const WeekQuery = z.object({ start: WeekStart.optional() });

insights.get("/api/insights/week", ...deliveryHeadOnly, async (req, res) => {
  const query = WeekQuery.safeParse(req.query);
  if (!query.success) return badInput(res, query.error);
  const thisWeek = weekStartOf(new Date());
  res
    .set("Cache-Control", "private, no-store")
    .json(await weekInsights(query.data.start ?? thisWeek, thisWeek));
});

insights.post(
  "/api/insights/sample/:applicationId/review",
  ...deliveryHeadOnly,
  async (req, res) => {
    const input = SampleReviewInput.safeParse(req.body);
    if (!input.success) return badInput(res, input.error);
    const { weekStart, verdict, note } = input.data;
    const applicationId = String(req.params.applicationId);

    const g = await gather(weekStart);
    const picked = g.picked.find((p) => p.item.applicationId === applicationId);
    if (!picked) {
      res
        .status(404)
        .json({ error: "That decision is not in this week's sample." });
      return;
    }
    const item = sampleItem(g, picked.item, picked.disagreement);
    // The band, decision and requisition are copied so the verdict outlives
    // the application.
    const data = {
      verdict,
      note: note || null,
      reviewedById: req.user!.id,
      reviewedAt: new Date(),
      band: item.band,
      decision: item.action,
      requisitionNumber: item.requisitionNumber,
    };
    await prisma.sampleReview.upsert({
      where: {
        weekStart_applicationId: { weekStart: dayOf(weekStart), applicationId },
      },
      create: { weekStart: dayOf(weekStart), applicationId, ...data },
      update: data,
    });
    await audit({
      action: "SAMPLE_REVIEWED",
      actorId: req.user!.id,
      entityType: "Application",
      entityId: applicationId,
      meta: { weekStart, verdict },
      ip: req.ip,
    });
    res.json({ verdict, note: data.note });
  },
);
