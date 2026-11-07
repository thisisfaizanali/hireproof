import { Router } from "express";
import {
  AuditQuery,
  addDays,
  formatReqNumber,
  parseIst,
  type AuditPageView,
} from "@hireproof/shared";
import { requireAuth, requireRole } from "./auth";
import { describe } from "./auditDescribe";
import { prisma } from "./db";
import type { Prisma } from "./generated/prisma/client";
import { badInput } from "./http";

export const auditLog = Router();

const PAGE_SIZE = 50;

const str = (v: unknown) => (typeof v === "string" ? v : null);

// Everything an event can be about: itself, and the applications and CVs that
// belong to a candidate or a requisition.
async function subjectFilter(
  subject: string,
): Promise<{ where: Prisma.AuditEventWhereInput; note: string | null }> {
  const code = /^CND-\d+$/i.exec(subject);
  const number = /^REQ-?0*(\d+)$/i.exec(subject);
  if (code) {
    const upper = subject.toUpperCase();
    const candidate = await prisma.candidate.findUnique({
      where: { code: upper },
      select: {
        id: true,
        applications: { select: { id: true } },
        cvs: { select: { id: true } },
      },
    });
    const deleted: Prisma.AuditEventWhereInput = {
      action: "CANDIDATE_DELETED",
      meta: { path: ["code"], equals: upper },
    };
    if (!candidate) {
      return { where: deleted, note: "No candidate has that code." };
    }
    return {
      where: {
        OR: [
          deleted,
          { entityType: "Candidate", entityId: candidate.id },
          {
            entityType: "Application",
            entityId: { in: candidate.applications.map((a) => a.id) },
          },
          {
            entityType: "CvDocument",
            entityId: { in: candidate.cvs.map((c) => c.id) },
          },
          { meta: { path: ["candidateId"], equals: candidate.id } },
        ],
      },
      note: null,
    };
  }
  if (number) {
    const requisition = await prisma.requisition.findUnique({
      where: { number: Number(number[1]) },
      select: {
        id: true,
        applications: { select: { id: true } },
        cvs: { select: { id: true } },
      },
    });
    if (!requisition) {
      return {
        where: { id: "none" },
        note: "No requisition has that number.",
      };
    }
    return {
      where: {
        OR: [
          { entityType: "Requisition", entityId: requisition.id },
          {
            entityType: "Application",
            entityId: { in: requisition.applications.map((a) => a.id) },
          },
          {
            entityType: "CvDocument",
            entityId: { in: requisition.cvs.map((c) => c.id) },
          },
          { meta: { path: ["requisitionId"], equals: requisition.id } },
        ],
      },
      note: null,
    };
  }
  return {
    where: { id: "none" },
    note: "Enter a candidate code like CND-10137 or a requisition like REQ-0009.",
  };
}

auditLog.get(
  "/api/audit",
  requireAuth,
  requireRole("DELIVERY_HEAD"),
  async (req, res) => {
    const query = AuditQuery.safeParse(req.query);
    if (!query.success) return badInput(res, query.error);
    const { page, person, action, from, to, subject } = query.data;

    const subjectPart = subject ? await subjectFilter(subject) : null;
    const where: Prisma.AuditEventWhereInput = {
      ...(person && { actorId: person }),
      ...(action && { action }),
      ...((from || to) && {
        createdAt: {
          ...(from && { gte: parseIst(`${from}T00:00`) ?? undefined }),
          ...(to && { lt: parseIst(`${addDays(to, 1)}T00:00`) ?? undefined }),
        },
      }),
      ...(subjectPart && { AND: [subjectPart.where] }),
    };

    const [total, events, people] = await Promise.all([
      prisma.auditEvent.count({ where }),
      prisma.auditEvent.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
      prisma.user.findMany({
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
    ]);

    const metas = events.map((e) => ({
      ...e,
      m: (e.meta && typeof e.meta === "object" && !Array.isArray(e.meta)
        ? e.meta
        : {}) as Record<string, unknown>,
    }));
    const ids = (type: string) => [
      ...new Set(
        metas.flatMap((e) =>
          e.entityType === type && e.entityId ? [e.entityId] : [],
        ),
      ),
    ];
    const candidateIds = [
      ...new Set([
        ...ids("Candidate"),
        ...metas.flatMap((e) => str(e.m.candidateId) ?? []),
      ]),
    ];
    const requisitionIds = [
      ...new Set([
        ...ids("Requisition"),
        ...metas.flatMap((e) => str(e.m.requisitionId) ?? []),
      ]),
    ];
    const [apps, cvs, candidates, requisitions] = await Promise.all([
      prisma.application.findMany({
        where: { id: { in: ids("Application") } },
        select: {
          id: true,
          candidate: { select: { code: true } },
          requisition: { select: { number: true } },
        },
      }),
      prisma.cvDocument.findMany({
        where: { id: { in: ids("CvDocument") } },
        select: {
          id: true,
          candidate: { select: { code: true } },
          requisition: { select: { number: true } },
        },
      }),
      prisma.candidate.findMany({
        where: { id: { in: candidateIds } },
        select: { id: true, code: true },
      }),
      prisma.requisition.findMany({
        where: { id: { in: requisitionIds } },
        select: { id: true, number: true },
      }),
    ]);
    const appById = new Map(apps.map((a) => [a.id, a]));
    const cvById = new Map(cvs.map((c) => [c.id, c]));
    const codeById = new Map(candidates.map((c) => [c.id, c.code]));
    const numberById = new Map(requisitions.map((r) => [r.id, r.number]));
    const nameById = new Map(people.map((p) => [p.id, p.name]));

    const rows = metas.map((e) => {
      const entity =
        e.entityType === "Application"
          ? appById.get(e.entityId ?? "")
          : e.entityType === "CvDocument"
            ? cvById.get(e.entityId ?? "")
            : undefined;
      const code =
        entity?.candidate?.code ??
        codeById.get(
          e.entityType === "Candidate"
            ? (e.entityId ?? "")
            : (str(e.m.candidateId) ?? ""),
        ) ??
        null;
      const number =
        entity?.requisition.number ??
        numberById.get(
          e.entityType === "Requisition"
            ? (e.entityId ?? "")
            : (str(e.m.requisitionId) ?? ""),
        );
      const person = e.actorId ? (nameById.get(e.actorId) ?? null) : null;
      return {
        id: e.id,
        at: e.createdAt.toISOString(),
        person,
        sentence: describe({
          action: e.action,
          person,
          meta: e.m,
          candidate: code,
          requisition: number === undefined ? null : formatReqNumber(number),
          target:
            e.entityType === "User" && e.entityId
              ? (nameById.get(e.entityId) ?? null)
              : null,
        }),
        ip: e.ip,
      };
    });

    const body: AuditPageView = {
      rows,
      total,
      page,
      pageSize: PAGE_SIZE,
      people,
      subjectNote: subjectPart?.note ?? null,
    };
    res.set("Cache-Control", "private, no-store").json(body);
  },
);
