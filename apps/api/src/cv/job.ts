import { prisma } from "../db";
import type { Prisma } from "../generated/prisma/client";
import { aiProfile, type AskAi } from "./aiProfile";
import {
  findDuplicate,
  surname,
  type DuplicateMatch,
  type KnownCandidate,
} from "./duplicates";
import { CvExtractError } from "./extract";
import type { CvProfile } from "./merge";
import { parseCv, type CvStage, type ParsedCv } from "./parse";
import { queueScoring } from "../score/trigger";

export interface JobDeps {
  ai: AskAi;
  today: () => Date;
}

const defaultDeps: JobDeps = {
  ai: (text) => aiProfile(text),
  today: () => new Date(),
};

const GENERIC_FAILURE =
  "Something went wrong while reading this file. Try it again.";

const DONE = ["PARSED", "NEEDS_REVIEW", "DUPLICATE_FILE"] as const;

type Tx = Prisma.TransactionClient;

// Serialises the step that decides "new candidate or existing one", so two CVs
// of the same person finishing together cannot both create a candidate.
export const lockCandidates = (tx: Tx) =>
  tx.$executeRaw`SELECT pg_advisory_xact_lock(7340211)`;

const ensureApplication = (
  tx: Tx,
  candidateId: string,
  requisitionId: string,
) =>
  tx.application.upsert({
    where: { candidateId_requisitionId: { candidateId, requisitionId } },
    create: { candidateId, requisitionId },
    update: {},
  });

async function knownCandidates(
  tx: Tx,
  profile: Pick<CvProfile, "name" | "email" | "phone">,
  sha256: string,
  cvId: string,
): Promise<KnownCandidate[]> {
  const last = surname(profile.name);
  const rows = await tx.candidate.findMany({
    where: {
      OR: [
        ...(profile.email ? [{ email: profile.email }] : []),
        ...(profile.phone ? [{ phone: profile.phone }] : []),
        ...(last.length >= 3
          ? [{ name: { endsWith: last, mode: "insensitive" as const } }]
          : []),
        { cvs: { some: { sha256, id: { not: cvId } } } },
      ],
    },
    include: {
      cvs: {
        where: { id: { not: cvId }, status: { in: [...DONE] } },
        select: { sha256: true, redactedText: true },
      },
    },
  });
  return rows.map((c) => ({
    id: c.id,
    name: c.name,
    email: c.email,
    phone: c.phone,
    fileHashes: c.cvs.map((cv) => cv.sha256),
    texts: c.cvs.flatMap((cv) => (cv.redactedText ? [cv.redactedText] : [])),
  }));
}

// The newest CV wins field by field, but a field it lacks keeps its old value:
// an older CV that has a CTC should not lose it to a newer one that does not.
export function mergedFields(
  old: {
    email: string | null;
    phone: string | null;
    location: string | null;
    currentRole: string | null;
    totalExperienceYears: Prisma.Decimal | null;
    skills: string[];
    noticeText: string | null;
    noticeDays: number | null;
    ctcText: string | null;
    currentCtcLpa: Prisma.Decimal | null;
    expectedCtcLpa: Prisma.Decimal | null;
  },
  fresh: CvProfile,
) {
  const hasNotice = fresh.noticeText !== null;
  const hasCtc = fresh.ctcText !== null;
  return {
    name: fresh.name,
    email: fresh.email ?? old.email,
    phone: fresh.phone ?? old.phone,
    location: fresh.location ?? old.location,
    currentRole: fresh.currentRole ?? old.currentRole,
    totalExperienceYears:
      fresh.totalExperienceYears ?? old.totalExperienceYears,
    skills: fresh.skills.length > 0 ? fresh.skills : old.skills,
    noticeText: hasNotice ? fresh.noticeText : old.noticeText,
    noticeDays: hasNotice ? fresh.noticeDays : old.noticeDays,
    ctcText: hasCtc ? fresh.ctcText : old.ctcText,
    currentCtcLpa: hasCtc ? fresh.currentCtcLpa : old.currentCtcLpa,
    expectedCtcLpa: hasCtc ? fresh.expectedCtcLpa : old.expectedCtcLpa,
  };
}

const newCandidateData = (p: CvProfile) => ({
  name: p.name,
  email: p.email,
  phone: p.phone,
  location: p.location,
  currentRole: p.currentRole,
  totalExperienceYears: p.totalExperienceYears,
  skills: p.skills,
  noticeText: p.noticeText,
  noticeDays: p.noticeDays,
  ctcText: p.ctcText,
  currentCtcLpa: p.currentCtcLpa,
  expectedCtcLpa: p.expectedCtcLpa,
});

export async function persistParsed(
  cv: { id: string; sha256: string; requisitionId: string },
  parsed: ParsedCv,
) {
  const { profile } = parsed;
  return prisma.$transaction(async (tx) => {
    await lockCandidates(tx);
    const known = await knownCandidates(tx, profile, cv.sha256, cv.id);
    const match: DuplicateMatch | null = findDuplicate(
      {
        sha256: cv.sha256,
        name: profile.name,
        email: profile.email,
        phone: profile.phone,
        text: parsed.redactedText,
      },
      known,
    );

    // A fuzzy match is only a suggestion, so the CV gets a candidate of its
    // own until a recruiter decides.
    const attachTo = match && match.kind !== "FUZZY" ? match.candidateId : null;
    let candidateId: string;
    if (attachTo) {
      const old = await tx.candidate.findUniqueOrThrow({
        where: { id: attachTo },
      });
      await tx.candidate.update({
        where: { id: attachTo },
        data: { ...mergedFields(old, profile), lastActivityAt: new Date() },
      });
      candidateId = attachTo;
    } else {
      candidateId = (
        await tx.candidate.create({ data: newCandidateData(profile) })
      ).id;
    }
    const application = await ensureApplication(
      tx,
      candidateId,
      cv.requisitionId,
    );

    await tx.cvDocument.update({
      where: { id: cv.id },
      data: {
        candidateId,
        text: parsed.text,
        redactedText: parsed.redactedText,
        textSource: parsed.textSource,
        ocrConfidence: parsed.ocrConfidence,
        status: parsed.reviewReasons.length > 0 ? "NEEDS_REVIEW" : "PARSED",
        reviewReasons: parsed.reviewReasons,
        failureReason: null,
        parseSource: parsed.parseSource,
        profile: { ...profile, employers: parsed.employers },
      },
    });
    await tx.consentRecord.updateMany({
      where: { cvId: cv.id },
      data: { candidateId },
    });

    if (match) {
      await tx.duplicateLink.create({
        data: {
          cvId: cv.id,
          candidateId: match.candidateId,
          kind: match.kind,
          similarity: match.similarity,
          reason: match.reason,
          status: match.kind === "FUZZY" ? "PENDING" : "AUTO_MERGED",
        },
      });
    }
    await tx.aiRun.create({
      data: {
        kind: "CV_PARSE",
        requisitionId: cv.requisitionId,
        ...parsed.run,
      },
    });
    return application.id;
  });
}

// Bytes already uploaded and parsed under another name need no second parse.
async function attachExactTwin(cv: {
  id: string;
  sha256: string;
  requisitionId: string;
}) {
  const twin = await prisma.cvDocument.findFirst({
    where: {
      sha256: cv.sha256,
      id: { not: cv.id },
      candidateId: { not: null },
      status: { in: [...DONE] },
    },
    orderBy: { createdAt: "asc" },
  });
  if (!twin?.candidateId) return null;
  const candidateId = twin.candidateId;
  return prisma.$transaction(async (tx) => {
    const application = await ensureApplication(
      tx,
      candidateId,
      cv.requisitionId,
    );
    await tx.cvDocument.update({
      where: { id: cv.id },
      data: { candidateId, status: "DUPLICATE_FILE", reviewReasons: [] },
    });
    await tx.consentRecord.updateMany({
      where: { cvId: cv.id },
      data: { candidateId },
    });
    await tx.candidate.update({
      where: { id: candidateId },
      data: { lastActivityAt: new Date() },
    });
    await tx.duplicateLink.create({
      data: {
        cvId: cv.id,
        candidateId,
        kind: "EXACT_FILE",
        similarity: 1,
        reason: "The same file was uploaded before",
        status: "AUTO_MERGED",
      },
    });
    return application.id;
  });
}

const setStatus = (id: string, status: CvStage) =>
  prisma.cvDocument.update({ where: { id }, data: { status } });

async function fail(id: string, failureReason: string) {
  await prisma.cvDocument.updateMany({
    where: { id },
    data: { status: "FAILED", failureReason, reviewReasons: [] },
  });
}

export async function processCv(cvId: string, deps: JobDeps = defaultDeps) {
  // Only one worker gets to start a CV. A job that runs again after a restart
  // finds the CV already claimed or finished and does nothing.
  const claimed = await prisma.cvDocument.updateMany({
    where: { id: cvId, status: "QUEUED" },
    data: { status: "EXTRACTING" },
  });
  if (claimed.count === 0) return;

  const cv = await prisma.cvDocument.findUnique({
    where: { id: cvId },
    select: {
      id: true,
      fileName: true,
      sha256: true,
      requisitionId: true,
      data: true,
    },
  });
  // Erased between the claim and the read.
  if (!cv) return;

  try {
    const twinned = await attachExactTwin(cv);
    if (twinned) {
      await queueScoring([twinned]);
      return;
    }
    const parsed = await parseCv(Buffer.from(cv.data), cv.fileName, {
      ai: deps.ai,
      today: deps.today(),
      onStage: (stage) => setStatus(cv.id, stage).then(() => undefined),
    });
    const applicationId = await persistParsed(cv, parsed);
    // A new CV is new evidence, so an earlier score for it is replaced.
    await queueScoring([applicationId], true);
  } catch (err) {
    // The candidate may have been erased while this ran: nothing is left to
    // record, and the transaction that was writing has already rolled back.
    if ((await prisma.cvDocument.count({ where: { id: cv.id } })) === 0) return;
    if (err instanceof CvExtractError) {
      await fail(cv.id, err.message);
      return;
    }
    console.error("CV job failed", cv.id, err);
    await fail(cv.id, GENERIC_FAILURE);
  }
}

// After a restart, CVs left mid-run go back in the queue. Their old jobs, if
// any survive, find the CV claimed or finished and do nothing.
export async function stuckCvIds() {
  const stuck = await prisma.cvDocument.findMany({
    where: { status: { in: ["EXTRACTING", "OCR", "PARSING"] } },
    select: { id: true },
  });
  if (stuck.length > 0) {
    await prisma.cvDocument.updateMany({
      where: { id: { in: stuck.map((c) => c.id) } },
      data: { status: "QUEUED" },
    });
  }
  return stuck.map((c) => c.id);
}
