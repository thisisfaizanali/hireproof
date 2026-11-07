import { Router, type Request, type RequestHandler } from "express";
import {
  constraintFlags,
  type CriterionScore,
  type PortalApplication,
  type PortalCandidateList,
  type PortalCandidateRow,
  type PortalCounts,
  type PortalRequisition,
  type SlotView,
  type Stage,
} from "@hireproof/shared";
import { audit } from "./audit";
import { requireAuth, requireRole } from "./auth";
import { maskContacts, redact } from "./cv/redact";
import { prisma } from "./db";
import type { Prisma } from "./generated/prisma/client";

export const portal = Router();

// Every portal route is for a hiring manager and is scoped to their client in
// the query itself, so another client's ids are simply not found.
export const clientOnly: RequestHandler[] = [
  requireAuth,
  requireRole("CLIENT_HM"),
  (req, res, next) => {
    if (!req.user?.client) {
      res.status(403).json({ error: "Not allowed" });
      return;
    }
    next();
  },
];

const clientId = (req: Request) => req.user!.client!.id;

// What a client may see of the pipeline: submitted and later, never drafts.
const VISIBLE: Stage[] = [
  "SUBMITTED",
  "CLIENT_SHORTLISTED",
  "INTERVIEW",
  "OFFERED",
  "JOINED",
  "REJECTED",
];

export const visibleTo = (id: string): Prisma.ApplicationWhereInput => ({
  requisition: { clientId: id, status: { not: "DRAFT" } },
  stage: { in: VISIBLE },
  submittedAt: { not: null },
});

const notFound = (what: string) => ({ error: `${what} not found` });

const emptyCounts = (): PortalCounts => ({
  submitted: 0,
  awaitingReview: 0,
  shortlisted: 0,
  interviews: 0,
});

function countStage(counts: PortalCounts, stage: Stage, n: number) {
  counts.submitted += n;
  if (stage === "SUBMITTED") counts.awaitingReview += n;
  if (stage === "CLIENT_SHORTLISTED") counts.shortlisted += n;
  if (stage === "INTERVIEW" || stage === "OFFERED" || stage === "JOINED") {
    counts.interviews += n;
  }
}

const num = (d: Prisma.Decimal | null) => (d === null ? null : Number(d));

export const slotView = (s: {
  id: string;
  startsAt: Date;
  durationMinutes: number;
  mode: SlotView["mode"];
  note: string | null;
  status: SlotView["status"];
}): SlotView => ({
  id: s.id,
  startsAt: s.startsAt.toISOString(),
  durationMinutes: s.durationMinutes,
  mode: s.mode,
  note: s.note,
  status: s.status,
});

const rowInclude = {
  candidate: {
    select: {
      code: true,
      name: true,
      currentRole: true,
      totalExperienceYears: true,
      noticeText: true,
      noticeDays: true,
      location: true,
      skills: true,
    },
  },
  scores: true,
  slots: { orderBy: { startsAt: "asc" } },
  requisition: {
    select: {
      id: true,
      number: true,
      title: true,
      scorecard: { select: { version: true } },
    },
  },
} satisfies Prisma.ApplicationInclude;

type Row = Prisma.ApplicationGetPayload<{ include: typeof rowInclude }>;

// The score for the scorecard now in force, or the latest if it is being
// redone. Only the band and the verdicts leave this file, never the total.
const scoreOf = (row: Row) =>
  row.scores.find(
    (s) => s.scorecardVersion === row.requisition.scorecard?.version,
  ) ?? [...row.scores].sort((a, b) => +b.createdAt - +a.createdAt)[0];

function toRow(row: Row): PortalCandidateRow {
  const c = row.candidate;
  const score = scoreOf(row);
  return {
    applicationId: row.id,
    code: c.code,
    name: c.name,
    currentRole: c.currentRole && maskContacts(c.currentRole),
    totalExperienceYears: num(c.totalExperienceYears),
    noticeText: c.noticeText && maskContacts(c.noticeText),
    noticeDays: c.noticeDays,
    location: c.location && maskContacts(c.location),
    stage: row.stage,
    submittedAt: row.submittedAt!.toISOString(),
    band: score?.band ?? null,
    mustHavesMet: score?.mustHavesMet ?? 0,
    mustHavesTotal: score?.mustHavesTotal ?? 0,
    flags: score ? constraintFlags(score.flags).map((f) => f.text) : [],
    rejection:
      row.stage === "REJECTED" &&
      row.rejectedBy === "CLIENT" &&
      row.clientRejectReason
        ? { reason: row.clientRejectReason, note: row.clientRejectNote }
        : null,
    slots: row.slots.map(slotView),
  };
}

portal.get("/api/portal/requisitions", ...clientOnly, async (req, res) => {
  const [rows, applications] = await Promise.all([
    prisma.requisition.findMany({
      where: { clientId: clientId(req), status: { not: "DRAFT" } },
      select: { id: true, number: true, title: true, status: true },
      orderBy: { number: "desc" },
    }),
    prisma.application.groupBy({
      by: ["requisitionId", "stage"],
      where: visibleTo(clientId(req)),
      _count: true,
    }),
  ]);
  const list: PortalRequisition[] = rows.map((r) => {
    const counts = emptyCounts();
    for (const a of applications) {
      if (a.requisitionId === r.id) countStage(counts, a.stage, a._count);
    }
    return { ...r, counts };
  });
  res.json(list);
});

portal.get(
  "/api/portal/requisitions/:id/candidates",
  ...clientOnly,
  async (req, res) => {
    const requisition = await prisma.requisition.findFirst({
      where: {
        id: String(req.params.id),
        clientId: clientId(req),
        status: { not: "DRAFT" },
      },
      select: { id: true, number: true, title: true, status: true },
    });
    if (!requisition) {
      res.status(404).json(notFound("Requisition"));
      return;
    }
    const rows = await prisma.application.findMany({
      where: { ...visibleTo(clientId(req)), requisitionId: requisition.id },
      include: rowInclude,
    });
    const counts = emptyCounts();
    for (const r of rows) countStage(counts, r.stage, 1);
    // Awaiting review first, then the newest submission.
    const items = rows
      .map(toRow)
      .sort(
        (a, b) =>
          Number(b.stage === "SUBMITTED") - Number(a.stage === "SUBMITTED") ||
          b.submittedAt.localeCompare(a.submittedAt),
      );
    const body: PortalCandidateList = { requisition, counts, items };
    res.json(body);
  },
);

portal.get("/api/portal/applications/:id", ...clientOnly, async (req, res) => {
  const row = await prisma.application.findFirst({
    where: { ...visibleTo(clientId(req)), id: String(req.params.id) },
    include: rowInclude,
  });
  if (!row) {
    res.status(404).json(notFound("Candidate"));
    return;
  }
  const cv = await prisma.cvDocument.findFirst({
    where: { candidateId: row.candidateId, text: { not: null } },
    orderBy: { createdAt: "desc" },
    select: { text: true },
  });
  const score = scoreOf(row);
  const name = row.candidate.name;
  const criteria = ((score?.criteria ?? []) as unknown as CriterionScore[])
    .map((c) => ({
      label: c.label,
      kind: c.kind,
      verdict: c.verdict,
      quotes: c.quotes
        .filter((q) => q.verified)
        .map((q) => maskContacts(q.text.replaceAll("[name]", name))),
    }))
    .sort(
      (a, b) => Number(a.kind !== "MUST_HAVE") - Number(b.kind !== "MUST_HAVE"),
    );

  await audit({
    action: "CLIENT_CANDIDATE_VIEWED",
    actorId: req.user!.id,
    entityType: "Application",
    entityId: row.id,
    meta: { requisitionId: row.requisitionId },
    ip: req.ip,
  });

  const body: PortalApplication = {
    ...toRow(row),
    requisition: {
      id: row.requisition.id,
      number: row.requisition.number,
      title: row.requisition.title,
    },
    skills: row.candidate.skills,
    note: maskContacts(row.submissionNote ?? ""),
    criteria,
    cvText: cv?.text ? redact(cv.text, name, { keepName: true }) : null,
  };
  res.set("Cache-Control", "private, no-store").json(body);
});
