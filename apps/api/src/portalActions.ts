import { Router, type Request } from "express";
import {
  ClientRejectInput,
  ProposeSlotsInput,
  canMove,
  parseIst,
  type Stage,
} from "@hireproof/shared";
import { audit } from "./audit";
import { prisma } from "./db";
import { badInput } from "./http";
import { clientOnly, visibleTo } from "./portal";

export const portalActions = Router();

// Found only if it belongs to this client and has been submitted.
const own = (req: Request) =>
  prisma.application.findFirst({
    where: {
      ...visibleTo(req.user!.client!.id),
      id: String(req.params.id),
    },
    select: { id: true, stage: true, requisitionId: true },
  });

const NOT_FOUND = { error: "Candidate not found" };
const ANSWERED = (what: string) => ({
  error: `${what} Ask your recruiter if you need to change it.`,
});

portalActions.post(
  "/api/portal/applications/:id/shortlist",
  ...clientOnly,
  async (req, res) => {
    const app = await own(req);
    if (!app) {
      res.status(404).json(NOT_FOUND);
      return;
    }
    const moved =
      canMove(app.stage as Stage, "CLIENT_SHORTLISTED", "CLIENT_HM") &&
      (
        await prisma.application.updateMany({
          where: { id: app.id, stage: "SUBMITTED" },
          data: { stage: "CLIENT_SHORTLISTED" },
        })
      ).count > 0;
    if (!moved) {
      res
        .status(409)
        .json(ANSWERED("This candidate has already been answered."));
      return;
    }
    await audit({
      action: "CLIENT_SHORTLISTED",
      actorId: req.user!.id,
      entityType: "Application",
      entityId: app.id,
      meta: { requisitionId: app.requisitionId },
      ip: req.ip,
    });
    res.json({ ok: true });
  },
);

portalActions.post(
  "/api/portal/applications/:id/reject",
  ...clientOnly,
  async (req, res) => {
    const input = ClientRejectInput.safeParse(req.body);
    if (!input.success) return badInput(res, input.error);
    const app = await own(req);
    if (!app) {
      res.status(404).json(NOT_FOUND);
      return;
    }
    const { reason, note } = input.data;
    const moved =
      canMove(app.stage as Stage, "REJECTED", "CLIENT_HM") &&
      (
        await prisma.application.updateMany({
          where: { id: app.id, stage: "SUBMITTED" },
          data: {
            stage: "REJECTED",
            rejectedBy: "CLIENT",
            clientRejectReason: reason,
            clientRejectNote: note || null,
          },
        })
      ).count > 0;
    if (!moved) {
      res
        .status(409)
        .json(ANSWERED("This candidate has already been answered."));
      return;
    }
    await audit({
      action: "CLIENT_REJECTED",
      actorId: req.user!.id,
      entityType: "Application",
      entityId: app.id,
      meta: { requisitionId: app.requisitionId, reason },
      ip: req.ip,
    });
    res.json({ ok: true });
  },
);

portalActions.post(
  "/api/portal/applications/:id/slots",
  ...clientOnly,
  async (req, res) => {
    const input = ProposeSlotsInput(new Date()).safeParse(req.body);
    if (!input.success) return badInput(res, input.error);
    const app = await own(req);
    if (!app) {
      res.status(404).json(NOT_FOUND);
      return;
    }
    if (app.stage !== "SUBMITTED" && app.stage !== "CLIENT_SHORTLISTED") {
      res
        .status(409)
        .json(
          ANSWERED(
            "Times can only be proposed for a candidate you are reviewing.",
          ),
        );
      return;
    }
    const pending = await prisma.interviewSlot.count({
      where: { applicationId: app.id, status: "PROPOSED" },
    });
    if (pending > 0) {
      res.status(409).json({
        error:
          "You have already proposed times. Your recruiter will confirm one.",
      });
      return;
    }

    const shortlisted = app.stage === "SUBMITTED";
    const slots = await prisma.$transaction(async (tx) => {
      // Proposing a time shortlists the candidate, as long as nobody answered
      // between the check above and now.
      const still = await tx.application.updateMany({
        where: {
          id: app.id,
          stage: { in: ["SUBMITTED", "CLIENT_SHORTLISTED"] },
        },
        data: { stage: "CLIENT_SHORTLISTED" },
      });
      if (still.count === 0) return null;
      return Promise.all(
        input.data.slots.map((s) =>
          tx.interviewSlot.create({
            data: {
              applicationId: app.id,
              startsAt: parseIst(s.startsAt)!,
              durationMinutes: s.durationMinutes,
              mode: s.mode,
              note: s.note || null,
              proposedById: req.user!.id,
            },
          }),
        ),
      );
    });
    if (!slots) {
      res
        .status(409)
        .json(ANSWERED("This candidate has already been answered."));
      return;
    }
    if (shortlisted) {
      await audit({
        action: "CLIENT_SHORTLISTED",
        actorId: req.user!.id,
        entityType: "Application",
        entityId: app.id,
        meta: { requisitionId: app.requisitionId, withSlots: true },
        ip: req.ip,
      });
    }
    await audit({
      action: "SLOT_PROPOSED",
      actorId: req.user!.id,
      entityType: "Application",
      entityId: app.id,
      meta: { requisitionId: app.requisitionId, slots: slots.length },
      ip: req.ip,
    });
    res.status(201).json({ ok: true, slots: slots.length });
  },
);
