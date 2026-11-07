import { Router, type Response } from "express";
import {
  RejectInput,
  SCREEN_GATE_MESSAGE,
  SubmitInput,
  canMove,
  type ApplicationInfo,
  type ScoreResponse,
} from "@hireproof/shared";
import { audit } from "./audit";
import { requireAuth, requireRole } from "./auth";
import { prisma } from "./db";
import { badInput } from "./http";
import { currentCv } from "./score/job";
import { queueScoring } from "./score/trigger";
import { pendingState, toDetail } from "./score/view";

export const applications = Router();

const recruiterOnly = [requireAuth, requireRole("RECRUITER")];
const readers = [requireAuth, requireRole("RECRUITER", "DELIVERY_HEAD")];

const IN_FLIGHT = ["QUEUED", "EXTRACTING", "OCR", "PARSING"];

export const load = (id: string) =>
  prisma.application.findUnique({
    where: { id },
    include: {
      candidate: true,
      requisition: {
        select: {
          id: true,
          number: true,
          title: true,
          scorecard: { select: { status: true, version: true } },
        },
      },
      scores: true,
    },
  });

type Loaded = NonNullable<Awaited<ReturnType<typeof load>>>;

const notFound = (res: Response) =>
  res.status(404).json({ error: "Application not found" });

export const hasViewed = async (userId: string, cvId: string) =>
  (await prisma.auditEvent.count({
    where: {
      action: "CV_VIEWED",
      actorId: userId,
      entityType: "CvDocument",
      entityId: cvId,
    },
  })) > 0;

const liveScore = (app: Loaded) => {
  const card = app.requisition.scorecard;
  return card?.status === "CONFIRMED"
    ? app.scores.find((s) => s.scorecardVersion === card.version)
    : undefined;
};

// The AI's view of this candidate when a recruiter decides, kept on the audit
// event so it can later be set beside what the recruiter chose.
export const bandAtDecision = (app: Loaded) => {
  const score =
    liveScore(app) ??
    [...app.scores].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    )[0];
  return score
    ? {
        band: score.band,
        total: score.total,
        scoreSource: score.source,
        scorecardVersion: score.scorecardVersion,
        stale: liveScore(app) === undefined,
      }
    : { band: null };
};

applications.get(
  "/api/applications/:id/score",
  ...readers,
  async (req, res) => {
    const app = await load(String(req.params.id));
    if (!app) return notFound(res);
    const cv = await currentCv(app.candidateId);
    const cvs = await prisma.cvDocument.findMany({
      where: { candidateId: app.candidateId },
      select: { status: true },
    });

    const row = liveScore(app);
    const application: ApplicationInfo = {
      id: app.id,
      stage: app.stage,
      rejectReason: app.rejectReason,
      rejectNote: app.rejectNote,
      decidedAt: app.decidedAt?.toISOString() ?? null,
      requisition: {
        id: app.requisition.id,
        number: app.requisition.number,
        title: app.requisition.title,
      },
      candidate: {
        id: app.candidate.id,
        code: app.candidate.code,
        name: app.candidate.name,
      },
      cvId: cv?.id ?? null,
      cvViewed: cv ? await hasViewed(req.user!.id, cv.id) : false,
      scorecardConfirmed: app.requisition.scorecard?.status === "CONFIRMED",
    };
    const body: ScoreResponse = {
      application,
      state: row
        ? "SCORED"
        : pendingState({
            hasOlderScore: app.scores.length > 0,
            scoringStartedAt: app.scoringStartedAt,
            hasScorableCv: Boolean(cv?.redactedText),
            cvInFlight: cvs.some((c) => IN_FLIGHT.includes(c.status)),
          }),
      score:
        row && cv
          ? toDetail(row, {
              applicationId: app.id,
              candidateId: app.candidateId,
              cvId: cv.id,
              experienceYears:
                app.candidate.totalExperienceYears === null
                  ? null
                  : Number(app.candidate.totalExperienceYears),
            })
          : null,
    };
    res.json(body);
  },
);

applications.post(
  "/api/applications/:id/screen",
  ...recruiterOnly,
  async (req, res) => {
    const app = await load(String(req.params.id));
    if (!app) return notFound(res);
    if (app.stage !== "SOURCED") {
      res
        .status(409)
        .json({ error: "Only a sourced candidate can be marked screened." });
      return;
    }
    // The page disables the button, but the server is the gate: only this
    // recruiter's own logged view of the CV counts.
    const cv = await currentCv(app.candidateId);
    if (!cv || !(await hasViewed(req.user!.id, cv.id))) {
      res.status(409).json({ error: SCREEN_GATE_MESSAGE });
      return;
    }
    const moved = await prisma.application.updateMany({
      where: { id: app.id, stage: "SOURCED" },
      data: {
        stage: "SCREENED",
        decidedById: req.user!.id,
        decidedAt: new Date(),
      },
    });
    if (moved.count === 0) {
      res.status(409).json({ error: "This candidate was already moved." });
      return;
    }
    await audit({
      action: "APPLICATION_SCREENED",
      actorId: req.user!.id,
      entityType: "Application",
      entityId: app.id,
      meta: { ...bandAtDecision(app), cvId: cv.id },
      ip: req.ip,
    });
    res.json({ ok: true });
  },
);

applications.post(
  "/api/applications/:id/reject",
  ...recruiterOnly,
  async (req, res) => {
    const input = RejectInput.safeParse(req.body);
    if (!input.success) {
      res.status(400).json({
        error: input.error.issues[0]?.message ?? "Choose a reason",
      });
      return;
    }
    const app = await load(String(req.params.id));
    if (!app) return notFound(res);
    const { reason, note } = input.data;
    const moved = await prisma.application.updateMany({
      where: { id: app.id, stage: { in: ["SOURCED", "SCREENED"] } },
      data: {
        stage: "REJECTED",
        rejectedBy: "RECRUITER",
        rejectReason: reason,
        rejectNote: note || null,
        decidedById: req.user!.id,
        decidedAt: new Date(),
      },
    });
    if (moved.count === 0) {
      res.status(409).json({ error: "This candidate was already moved." });
      return;
    }
    await audit({
      action: "APPLICATION_REJECTED",
      actorId: req.user!.id,
      entityType: "Application",
      entityId: app.id,
      meta: { ...bandAtDecision(app), reason, fromStage: app.stage },
      ip: req.ip,
    });
    res.json({ ok: true });
  },
);

// Recruiters make mistakes, so a rejection can be undone.
applications.post(
  "/api/applications/:id/reopen",
  ...recruiterOnly,
  async (req, res) => {
    const app = await load(String(req.params.id));
    if (!app) return notFound(res);
    const moved = await prisma.application.updateMany({
      where: { id: app.id, stage: "REJECTED", submittedAt: null },
      data: {
        stage: "SOURCED",
        rejectedBy: null,
        rejectReason: null,
        rejectNote: null,
        decidedById: req.user!.id,
        decidedAt: new Date(),
      },
    });
    if (moved.count === 0) {
      res.status(409).json({
        error:
          "Only a candidate you rejected before submitting can be reopened.",
      });
      return;
    }
    await audit({
      action: "APPLICATION_REOPENED",
      actorId: req.user!.id,
      entityType: "Application",
      entityId: app.id,
      meta: { previousReason: app.rejectReason },
      ip: req.ip,
    });
    res.json({ ok: true });
  },
);

applications.post(
  "/api/applications/:id/rescore",
  ...recruiterOnly,
  async (req, res) => {
    const app = await load(String(req.params.id));
    if (!app) return notFound(res);
    if (app.requisition.scorecard?.status !== "CONFIRMED") {
      res.status(409).json({ error: "Confirm the scorecard before scoring." });
      return;
    }
    await queueScoring([app.id], true);
    res.status(202).json({ ok: true });
  },
);

// The recruiter's case for a candidate goes to the client with the stage change.
applications.post(
  "/api/applications/:id/submit",
  ...recruiterOnly,
  async (req, res) => {
    const input = SubmitInput.safeParse(req.body);
    if (!input.success) return badInput(res, input.error);
    const app = await load(String(req.params.id));
    if (!app) return notFound(res);
    if (!canMove(app.stage, "SUBMITTED", "RECRUITER")) {
      res.status(409).json({
        error: "Only a screened candidate can be submitted to the client.",
      });
      return;
    }
    const moved = await prisma.application.updateMany({
      where: { id: app.id, stage: "SCREENED" },
      data: {
        stage: "SUBMITTED",
        submittedAt: new Date(),
        submittedById: req.user!.id,
        submissionNote: input.data.note,
      },
    });
    if (moved.count === 0) {
      res.status(409).json({ error: "This candidate was already moved." });
      return;
    }
    await audit({
      action: "APPLICATION_SUBMITTED",
      actorId: req.user!.id,
      entityType: "Application",
      entityId: app.id,
      meta: { ...bandAtDecision(app), noteLength: input.data.note.length },
      ip: req.ip,
    });
    res.json({ ok: true });
  },
);

// Only until the client has acted on it.
applications.post(
  "/api/applications/:id/withdraw",
  ...recruiterOnly,
  async (req, res) => {
    const app = await load(String(req.params.id));
    if (!app) return notFound(res);
    const moved = await prisma.application.updateMany({
      where: { id: app.id, stage: "SUBMITTED" },
      data: { stage: "WITHDRAWN" },
    });
    if (moved.count === 0) {
      res.status(409).json({
        error:
          "Only a submission the client has not acted on can be withdrawn.",
      });
      return;
    }
    await audit({
      action: "SUBMISSION_WITHDRAWN",
      actorId: req.user!.id,
      entityType: "Application",
      entityId: app.id,
      ip: req.ip,
    });
    res.json({ ok: true });
  },
);
