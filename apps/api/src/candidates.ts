import { Router } from "express";
import { z } from "zod";
import {
  BAND_FILTERS,
  ResolveDuplicateInput,
  STAGE_FILTERS,
  canonicalSkill,
  constraintFlags,
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
import { SCORABLE, hasScorableCv, queueCandidate } from "./score/trigger";
import { pendingState, toSummary } from "./score/view";

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
  band: z.enum(BAND_FILTERS).optional(),
  stage: z.enum(STAGE_FILTERS).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});

const BAND_ORDER = { STRONG: 0, POSSIBLE: 1, WEAK: 2 } as const;
const IN_FLIGHT = ["QUEUED", "EXTRACTING", "OCR", "PARSING"];

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
    const { search, status, band, stage, page } = query.data;
    const requisitionId = String(req.params.id);

    const requisition = await prisma.requisition.findUnique({
      where: { id: requisitionId },
      select: { scorecard: { select: { status: true, version: true } } },
    });
    if (!requisition) {
      res.status(404).json({ error: "Requisition not found" });
      return;
    }
    const version =
      requisition.scorecard?.status === "CONFIRMED"
        ? requisition.scorecard.version
        : null;

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
      ...(stage && { stage }),
      ...(version !== null &&
        band === "UNSCORED" && {
          scores: { none: { scorecardVersion: version } },
        }),
      ...(version !== null &&
        band &&
        band !== "UNSCORED" && {
          scores: { some: { scorecardVersion: version, band } },
        }),
    };

    const include = {
      candidate: {
        include: {
          cvs: {
            orderBy: { createdAt: "desc" },
            select: {
              id: true,
              status: true,
              textSource: true,
              createdAt: true,
            },
          },
          duplicateLinks: {
            where: { status: "PENDING" },
            select: { id: true },
            take: 1,
          },
        },
      },
      scores: {
        select: {
          scorecardVersion: true,
          total: true,
          band: true,
          mustHavesMet: true,
          mustHavesTotal: true,
          flags: true,
          source: true,
        },
      },
    } satisfies Prisma.ApplicationInclude;

    // A ranking has to see every row to order it; an unranked list can let
    // the database page it.
    const [total, found, progress] = await Promise.all([
      prisma.application.count({ where }),
      prisma.application.findMany({
        where,
        include,
        orderBy: { createdAt: "desc" },
        ...(version === null && {
          skip: (page - 1) * PAGE_SIZE,
          take: PAGE_SIZE,
        }),
      }),
      version === null
        ? null
        : Promise.all([
            prisma.candidateScore.count({
              where: {
                scorecardVersion: version,
                application: { requisitionId },
              },
            }),
            prisma.application.count({
              where: { requisitionId, candidate: hasScorableCv },
            }),
          ]),
    ]);

    type Row = (typeof found)[number];
    const scorableCvOf = (row: Row) =>
      row.candidate.cvs.find((cv) =>
        (SCORABLE as readonly string[]).includes(cv.status),
      );
    const currentScore = (row: Row) =>
      version === null
        ? undefined
        : row.scores.find((s) => s.scorecardVersion === version);

    let rows = found;
    if (version !== null) {
      rows = [...found].sort((a, b) => {
        const x = currentScore(a);
        const y = currentScore(b);
        if (!x || !y) return x ? -1 : y ? 1 : 0;
        return (
          BAND_ORDER[x.band] - BAND_ORDER[y.band] ||
          y.total - x.total ||
          y.mustHavesMet - x.mustHavesMet ||
          (scorableCvOf(b)?.createdAt.getTime() ?? 0) -
            (scorableCvOf(a)?.createdAt.getTime() ?? 0)
        );
      });
    }
    const first = version === null ? 0 : (page - 1) * PAGE_SIZE;
    const pageRows =
      version === null ? rows : rows.slice(first, first + PAGE_SIZE);

    // A candidate flagged as a possible duplicate may be the new side of a link
    // (their CV is the one under review) rather than the matched side.
    const ids = pageRows.map((r) => r.candidateId);
    const asNewSide = await prisma.duplicateLink.findMany({
      where: { status: "PENDING", cv: { candidateId: { in: ids } } },
      select: { cv: { select: { candidateId: true } } },
    });
    const flagged = new Set(asNewSide.map((l) => l.cv.candidateId));

    const items: CandidateRow[] = pageRows.map((row, i) => {
      const { candidate: c, stage } = row;
      const latest = c.cvs[0];
      const score = currentScore(row);
      const scorable = scorableCvOf(row);
      return {
        applicationId: row.id,
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
        rank: score ? first + i + 1 : null,
        score: score ? toSummary(score) : null,
        constraintFlags: score ? constraintFlags(score.flags) : [],
        scoreState:
          version === null
            ? null
            : score
              ? "SCORED"
              : pendingState({
                  hasOlderScore: row.scores.length > 0,
                  scoringStartedAt: row.scoringStartedAt,
                  hasScorableCv: scorable !== undefined,
                  cvInFlight: c.cvs.some((cv) => IN_FLIGHT.includes(cv.status)),
                }),
        cvId: scorable?.id ?? latest?.id ?? null,
      };
    });
    const list: CandidateList = {
      items,
      total,
      page,
      pageSize: PAGE_SIZE,
      ranked: version !== null,
      scorecardVersion: version,
      progress: progress && { scored: progress[0], total: progress[1] },
    };
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

  // Scored applications link to the CV the score was read from.
  const currentCvId =
    row.cvs.find((cv) => (SCORABLE as readonly string[]).includes(cv.status))
      ?.id ??
    row.cvs[0]?.id ??
    null;

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
    applications: row.applications.map((a) => {
      const card = a.requisition.scorecard;
      const score =
        card?.status === "CONFIRMED"
          ? a.scores.find((s) => s.scorecardVersion === card.version)
          : undefined;
      return {
        id: a.id,
        stage: a.stage,
        requisition: {
          id: a.requisition.id,
          number: a.requisition.number,
          title: a.requisition.title,
        },
        score: score ? toSummary(score) : null,
        cvId: currentCvId,
      };
    }),
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
    // The merged candidate has a newer CV and fuller details to score on.
    if (samePerson) await queueCandidate(link.candidateId);

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
