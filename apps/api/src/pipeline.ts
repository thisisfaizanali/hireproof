import { Router, type Response } from "express";
import {
  MoveInput,
  PIPELINE_FROM,
  STAGE_NAME,
  canMove,
  type MessageView,
  type Stage,
} from "@hireproof/shared";
import { audit } from "./audit";
import { requireAuth, requireRole } from "./auth";
import { prisma } from "./db";
import { badInput } from "./http";
import { interviewInvite, noTimesWork, recordMessage } from "./messages";
import { bandAtDecision, load } from "./applications";

export const pipeline = Router();

const recruiterOnly = [requireAuth, requireRole("RECRUITER")];

const toMessage = (m: {
  id: string;
  recipient: MessageView["recipient"];
  subject: string;
  body: string;
  createdAt: Date;
}): MessageView => ({
  id: m.id,
  recipient: m.recipient,
  subject: m.subject,
  body: m.body,
  createdAt: m.createdAt.toISOString(),
});

const notFound = (res: Response, what: string) =>
  res.status(404).json({ error: `${what} not found` });

pipeline.post(
  "/api/applications/:id/move",
  ...recruiterOnly,
  async (req, res) => {
    const input = MoveInput.safeParse(req.body);
    if (!input.success) return badInput(res, input.error);
    const app = await load(String(req.params.id));
    if (!app) return notFound(res, "Application");
    const from = app.stage as Stage;
    const { to } = input.data;
    if (!PIPELINE_FROM.includes(from) || !canMove(from, to, "RECRUITER")) {
      res.status(409).json({
        error: `A candidate who is ${STAGE_NAME[from]} cannot be moved to ${STAGE_NAME[to]}.`,
      });
      return;
    }
    const moved = await prisma.application.updateMany({
      where: { id: app.id, stage: from },
      data: {
        stage: to,
        ...(to === "REJECTED" && {
          rejectedBy: "RECRUITER" as const,
          decidedById: req.user!.id,
          decidedAt: new Date(),
        }),
      },
    });
    if (moved.count === 0) {
      res.status(409).json({ error: "This candidate was already moved." });
      return;
    }
    await audit({
      action: "STAGE_CHANGED",
      actorId: req.user!.id,
      entityType: "Application",
      entityId: app.id,
      meta: { from, to, ...bandAtDecision(app) },
      ip: req.ip,
    });
    res.json({ ok: true });
  },
);

// Confirming one proposed time books the interview, declines the others and
// records the message that would go to the candidate.
pipeline.post("/api/slots/:id/confirm", ...recruiterOnly, async (req, res) => {
  const slot = await prisma.interviewSlot.findUnique({
    where: { id: String(req.params.id) },
    include: {
      application: {
        include: {
          candidate: { select: { name: true } },
          requisition: {
            select: { title: true, client: { select: { name: true } } },
          },
        },
      },
    },
  });
  if (!slot) return notFound(res, "Time");
  const app = slot.application;
  if (slot.status !== "PROPOSED") {
    res.status(409).json({ error: "This time has already been answered." });
    return;
  }
  if (!canMove(app.stage, "INTERVIEW", "RECRUITER")) {
    res.status(409).json({
      error: `A candidate who is ${STAGE_NAME[app.stage]} cannot be booked for an interview.`,
    });
    return;
  }

  const mail = interviewInvite({
    candidateName: app.candidate.name,
    clientName: app.requisition.client.name,
    title: app.requisition.title,
    startsAt: slot.startsAt,
    durationMinutes: slot.durationMinutes,
    mode: slot.mode,
    note: slot.note,
    recruiterName: req.user!.name,
  });
  const message = await prisma.$transaction(async (tx) => {
    const moved = await tx.application.updateMany({
      where: { id: app.id, stage: "CLIENT_SHORTLISTED" },
      data: { stage: "INTERVIEW" },
    });
    const claimed = await tx.interviewSlot.updateMany({
      where: { id: slot.id, status: "PROPOSED" },
      data: { status: "CONFIRMED" },
    });
    if (moved.count === 0 || claimed.count === 0) return null;
    await tx.interviewSlot.updateMany({
      where: { applicationId: app.id, status: "PROPOSED" },
      data: { status: "DECLINED" },
    });
    return tx.outboundMessage.create({
      data: {
        applicationId: app.id,
        recipient: "CANDIDATE",
        createdById: req.user!.id,
        ...mail,
      },
    });
  });
  if (!message) {
    res.status(409).json({ error: "This candidate was already moved." });
    return;
  }
  const base = {
    actorId: req.user!.id,
    entityType: "Application",
    entityId: app.id,
    ip: req.ip,
  };
  await audit({ ...base, action: "SLOT_CONFIRMED", meta: { slotId: slot.id } });
  await audit({
    ...base,
    action: "STAGE_CHANGED",
    meta: { from: "CLIENT_SHORTLISTED", to: "INTERVIEW" },
  });
  await audit({
    ...base,
    action: "MESSAGE_RECORDED",
    meta: { messageId: message.id, recipient: "CANDIDATE", status: "MOCKED" },
  });
  res.json({ message: toMessage(message) });
});

pipeline.post(
  "/api/applications/:id/slots/decline",
  ...recruiterOnly,
  async (req, res) => {
    const app = await prisma.application.findUnique({
      where: { id: String(req.params.id) },
      include: {
        candidate: { select: { name: true } },
        requisition: { select: { title: true } },
      },
    });
    if (!app) return notFound(res, "Application");
    const declined = await prisma.interviewSlot.updateMany({
      where: { applicationId: app.id, status: "PROPOSED" },
      data: { status: "DECLINED" },
    });
    if (declined.count === 0) {
      res
        .status(409)
        .json({ error: "There are no proposed times to decline." });
      return;
    }
    const message = await recordMessage({
      applicationId: app.id,
      recipient: "CLIENT",
      createdById: req.user!.id,
      ...noTimesWork({
        candidateName: app.candidate.name,
        title: app.requisition.title,
        recruiterName: req.user!.name,
      }),
    });
    const base = {
      actorId: req.user!.id,
      entityType: "Application",
      entityId: app.id,
      ip: req.ip,
    };
    await audit({
      ...base,
      action: "SLOTS_DECLINED",
      meta: { slots: declined.count },
    });
    await audit({
      ...base,
      action: "MESSAGE_RECORDED",
      meta: { messageId: message.id, recipient: "CLIENT", status: "MOCKED" },
    });
    res.json({ message: toMessage(message) });
  },
);
