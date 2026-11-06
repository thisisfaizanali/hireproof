import { Router } from "express";
import { z } from "zod";
import {
  ResolveDuplicateInput,
  canonicalSkill,
  type CandidateDetail,
  type CandidateList,
  type CandidateRow,
  type DuplicateSide,
  type PendingDuplicate,
} from "@hireproof/shared";
import { audit } from "./audit";
import { requireAuth, requireRole } from "./auth";
import { mergedFields } from "./cv/job";
import type { CvProfile } from "./cv/merge";
import { prisma } from "./db";
import type { Prisma } from "./generated/prisma/client";

export const candidates = Router();

const recruiterOnly = [requireAuth, requireRole("RECRUITER")];
const readers = [requireAuth, requireRole("RECRUITER", "DELIVERY_HEAD")];

const PAGE_SIZE = 50;
const num = (d: Prisma.Decimal | null) => (d === null ? null : Number(d));

const ListQuery = z.object({
  search: z.string().trim().max(100).optional(),
  status: z
    .enum(["PARSED", "NEEDS_REVIEW", "SCANNED", "POSSIBLE_DUPLICATE"])
    .optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});

// Flagged on both sides of a pending link: the candidate the CV matched, and
// the candidate created for the CV under review.
const POSSIBLE_DUPLICATE: Prisma.CandidateWhereInput = {
  OR: [
    { duplicateLinks: { some: { status: "PENDING" } } },
    { cvs: { some: { duplicateLinks: { some: { status: "PENDING" } } } } },
  ],
};

candidates.get(
  "/api/requisitions/:id/candidates",
  ...readers,
  async (req, res) => {
    const query = ListQuery.safeParse(req.query);
    if (!query.success) {
      res.status(400).json({ error: "Check the search and filter values" });
      return;
    }
    const { search, status, page } = query.data;
    const requisitionId = String(req.params.id);

    const candidateWhere: Prisma.CandidateWhereInput = {
      AND: [
        ...(search
          ? [
              {
                OR: [
                  { name: { contains: search, mode: "insensitive" as const } },
                  { code: { contains: search, mode: "insensitive" as const } },
                  {
                    currentRole: {
                      contains: search,
                      mode: "insensitive" as const,
                    },
                  },
                  { skills: { has: canonicalSkill(search) ?? search } },
                ],
              },
            ]
          : []),
        ...(status === "NEEDS_REVIEW" || status === "PARSED"
          ? [{ cvs: { some: { requisitionId, status } } }]
          : []),
        ...(status === "SCANNED"
          ? [{ cvs: { some: { requisitionId, textSource: "OCR" as const } } }]
          : []),
        ...(status === "POSSIBLE_DUPLICATE" ? [POSSIBLE_DUPLICATE] : []),
      ],
    };
    const where: Prisma.ApplicationWhereInput = {
      requisitionId,
      candidate: candidateWhere,
    };

    const [total, rows] = await Promise.all([
      prisma.application.count({ where }),
      prisma.application.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        include: {
          candidate: {
            include: {
              cvs: {
                orderBy: { createdAt: "desc" },
                select: { status: true, textSource: true },
              },
              duplicateLinks: {
                where: { status: "PENDING" },
                select: { id: true },
                take: 1,
              },
            },
          },
        },
      }),
    ]);

    // A candidate flagged as a possible duplicate may be the new side of a link
    // (their CV is the one under review) rather than the matched side.
    const ids = rows.map((r) => r.candidateId);
    const asNewSide = await prisma.duplicateLink.findMany({
      where: { status: "PENDING", cv: { candidateId: { in: ids } } },
      select: { cv: { select: { candidateId: true } } },
    });
    const flagged = new Set(asNewSide.map((l) => l.cv.candidateId));

    const items: CandidateRow[] = rows.map(({ candidate: c, stage }) => {
      const latest = c.cvs[0];
      return {
        id: c.id,
        code: c.code,
        name: c.name,
        currentRole: c.currentRole,
        totalExperienceYears: num(c.totalExperienceYears),
        noticeText: c.noticeText,
        noticeDays: c.noticeDays,
        ctcText: c.ctcText,
        location: c.location,
        skills: c.skills,
        stage,
        cvStatus: latest?.status ?? null,
        scanned: latest?.textSource === "OCR",
        needsReview: latest?.status === "NEEDS_REVIEW",
        possibleDuplicate: c.duplicateLinks.length > 0 || flagged.has(c.id),
      };
    });
    const list: CandidateList = { items, total, page, pageSize: PAGE_SIZE };
    res.json(list);
  },
);

candidates.get("/api/candidates/:id", ...readers, async (req, res) => {
  const row = await prisma.candidate.findUnique({
    where: { id: String(req.params.id) },
    include: {
      cvs: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          fileName: true,
          sizeBytes: true,
          status: true,
          textSource: true,
          ocrConfidence: true,
          parseSource: true,
          reviewReasons: true,
          failureReason: true,
          createdAt: true,
          requisition: { select: { id: true, title: true } },
          duplicateLinks: {
            orderBy: { createdAt: "desc" },
            include: {
              candidate: { select: { id: true, code: true, name: true } },
            },
          },
        },
      },
      applications: {
        orderBy: { createdAt: "desc" },
        include: {
          requisition: { select: { id: true, number: true, title: true } },
        },
      },
      duplicateLinks: {
        include: {
          cv: { select: { fileName: true, candidate: true } },
        },
      },
    },
  });
  if (!row) {
    res.status(404).json({ error: "Candidate not found" });
    return;
  }

  // Links from this candidate's own CVs, plus links where another candidate's
  // CV matched this one.
  const own = row.cvs.flatMap((cv) =>
    cv.duplicateLinks.map((l) => ({
      id: l.id,
      kind: l.kind,
      status: l.status,
      similarity: l.similarity,
      reason: l.reason,
      fileName: cv.fileName,
      other: l.candidate,
      createdAt: l.createdAt.toISOString(),
    })),
  );
  const incoming = row.duplicateLinks.flatMap((l) =>
    l.cv.candidate && l.cv.candidate.id !== row.id
      ? [
          {
            id: l.id,
            kind: l.kind,
            status: l.status,
            similarity: l.similarity,
            reason: l.reason,
            fileName: l.cv.fileName,
            other: {
              id: l.cv.candidate.id,
              code: l.cv.candidate.code,
              name: l.cv.candidate.name,
            },
            createdAt: l.createdAt.toISOString(),
          },
        ]
      : [],
  );

  const detail: CandidateDetail = {
    id: row.id,
    code: row.code,
    name: row.name,
    email: row.email,
    phone: row.phone,
    location: row.location,
    currentRole: row.currentRole,
    totalExperienceYears: num(row.totalExperienceYears),
    skills: row.skills,
    noticeText: row.noticeText,
    noticeDays: row.noticeDays,
    ctcText: row.ctcText,
    currentCtcLpa: num(row.currentCtcLpa),
    expectedCtcLpa: num(row.expectedCtcLpa),
    createdAt: row.createdAt.toISOString(),
    cvs: row.cvs.map((cv) => ({
      id: cv.id,
      fileName: cv.fileName,
      sizeBytes: cv.sizeBytes,
      status: cv.status,
      textSource: cv.textSource,
      ocrConfidence: cv.ocrConfidence,
      parseSource: cv.parseSource,
      reviewReasons: cv.reviewReasons,
      failureReason: cv.failureReason,
      createdAt: cv.createdAt.toISOString(),
      requisition: cv.requisition,
    })),
    applications: row.applications.map((a) => ({
      id: a.id,
      stage: a.stage,
      requisition: a.requisition,
    })),
    duplicates: [...own, ...incoming].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    ),
  };

  await audit({
    action: "CANDIDATE_PROFILE_VIEWED",
    actorId: req.user!.id,
    entityType: "Candidate",
    entityId: row.id,
    ip: req.ip,
  });
  res.json(detail);
});

// Duplicates

const side = async (candidateId: string): Promise<DuplicateSide> => {
  const c = await prisma.candidate.findUniqueOrThrow({
    where: { id: candidateId },
    include: {
      cvs: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { profile: true },
      },
    },
  });
  const profile = c.cvs[0]?.profile as { employers?: string[] } | null;
  return {
    id: c.id,
    code: c.code,
    name: c.name,
    email: c.email,
    phone: c.phone,
    employers: profile?.employers ?? [],
    totalExperienceYears: num(c.totalExperienceYears),
    currentRole: c.currentRole,
  };
};

const DuplicateQuery = z.object({
  status: z.enum(["PENDING"]).default("PENDING"),
  requisitionId: z.string().min(1).optional(),
});

candidates.get("/api/duplicates", ...readers, async (req, res) => {
  const query = DuplicateQuery.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: "Check the filter values" });
    return;
  }
  const links = await prisma.duplicateLink.findMany({
    where: {
      status: query.data.status,
      cv: { requisitionId: query.data.requisitionId },
    },
    orderBy: { createdAt: "desc" },
    include: {
      cv: {
        select: { fileName: true, candidateId: true, requisitionId: true },
      },
    },
  });
  const out: PendingDuplicate[] = [];
  for (const l of links) {
    if (!l.cv.candidateId) continue;
    out.push({
      id: l.id,
      kind: l.kind,
      similarity: l.similarity,
      reason: l.reason,
      fileName: l.cv.fileName,
      requisitionId: l.cv.requisitionId,
      incoming: await side(l.cv.candidateId),
      existing: await side(l.candidateId),
    });
  }
  res.json(out);
});

candidates.post(
  "/api/duplicates/:id/resolve",
  ...recruiterOnly,
  async (req, res) => {
    const input = ResolveDuplicateInput.safeParse(req.body);
    if (!input.success) {
      res.status(400).json({ error: "Say whether these are the same person" });
      return;
    }
    const link = await prisma.duplicateLink.findUnique({
      where: { id: String(req.params.id) },
      include: { cv: true },
    });
    if (!link) {
      res.status(404).json({ error: "Duplicate not found" });
      return;
    }
    const { samePerson } = input.data;
    const resolution = {
      resolvedById: req.user!.id,
      resolvedAt: new Date(),
    };

    // Claiming the link first makes a double click safe: the second request
    // waits on the row lock, then finds it no longer pending.
    const claimed = await prisma.$transaction(async (tx) => {
      const claim = await tx.duplicateLink.updateMany({
        where: { id: link.id, status: "PENDING" },
        data: {
          status: samePerson ? "SAME_PERSON" : "DIFFERENT_PEOPLE",
          ...resolution,
        },
      });
      if (claim.count === 0) return false;
      const sourceId = link.cv.candidateId;
      const targetId = link.candidateId;
      if (!samePerson || !sourceId || sourceId === targetId) return true;

      const target = await tx.candidate.findUniqueOrThrow({
        where: { id: targetId },
      });
      // The CV that was under review is the newest, so its details lead.
      await tx.candidate.update({
        where: { id: targetId },
        data: mergedFields(target, link.cv.profile as unknown as CvProfile),
      });
      await tx.cvDocument.updateMany({
        where: { candidateId: sourceId },
        data: { candidateId: targetId },
      });

      const apps = await tx.application.findMany({
        where: { candidateId: sourceId },
      });
      for (const app of apps) {
        const existing = await tx.application.findUnique({
          where: {
            candidateId_requisitionId: {
              candidateId: targetId,
              requisitionId: app.requisitionId,
            },
          },
        });
        if (existing) {
          await tx.application.delete({ where: { id: app.id } });
        } else {
          await tx.application.update({
            where: { id: app.id },
            data: { candidateId: targetId },
          });
        }
      }
      // Links that pointed at the candidate about to disappear.
      await tx.duplicateLink.updateMany({
        where: { candidateId: sourceId },
        data: { candidateId: targetId },
      });
      await tx.candidate.delete({ where: { id: sourceId } });
      return true;
    });
    if (!claimed) {
      res.status(409).json({ error: "This duplicate was already resolved." });
      return;
    }

    await audit({
      action: "DUPLICATE_RESOLVED",
      actorId: req.user!.id,
      entityType: "DuplicateLink",
      entityId: link.id,
      meta: { samePerson: input.data.samePerson },
      ip: req.ip,
    });
    res.json({ ok: true });
  },
);
