import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { app } from "../src/app";
import { prisma } from "../src/db";
import { eraseCandidate } from "../src/erasure";
import { processCv } from "../src/cv/job";
import { processScore } from "../src/score/job";
import { textCorpus } from "./cvCorpus";
import { resetDb } from "./helpers";
import {
  EMAIL,
  PHONE,
  candidateAt,
  createClient,
  createStaff,
  get,
  openRequisition,
} from "./pipelineHelpers";
import { findLeaks, textColumns } from "./sweep";

let head: Awaited<ReturnType<typeof createStaff>>;
let recruiter: Awaited<ReturnType<typeof createStaff>>;
let kestrel: Awaited<ReturnType<typeof createClient>>;
let requisitionId: string;

const erase = (cookie: string, id: string, body: object) =>
  request(app).delete(`/api/candidates/${id}`).set("Cookie", cookie).send(body);

beforeEach(async () => {
  await resetDb();
  head = await createStaff("DELIVERY_HEAD", "head@example.test");
  recruiter = await createStaff("RECRUITER", "recruiter@example.test");
  kestrel = await createClient("Kestrel", "priya@example.test");
  requisitionId = (await openRequisition(kestrel.client.id, recruiter.user.id))
    .id;
});

// A candidate with a submitted application, a score, proposed times, a message,
// a consent record and a duplicate link, so every table that holds them is hit.
async function fullCandidate(name = "Riya Sen") {
  const { candidate, cv, application } = await candidateAt(
    requisitionId,
    recruiter.user.id,
    "SUBMITTED",
    name,
  );
  await prisma.interviewSlot.createMany({
    data: [0, 1].map((i) => ({
      applicationId: application.id,
      startsAt: new Date(Date.now() + (i + 2) * 86_400_000),
      durationMinutes: 45,
      mode: "VIDEO" as const,
      note: `Call ${name} on ${PHONE}`,
      proposedById: kestrel.user.id,
    })),
  });
  await prisma.outboundMessage.create({
    data: {
      applicationId: application.id,
      recipient: "CANDIDATE",
      subject: `Interview for ${name}`,
      body: `Dear ${name}, write to ${EMAIL}`,
      createdById: recruiter.user.id,
    },
  });
  await prisma.consentRecord.create({
    data: {
      cvId: cv.id,
      candidateId: candidate.id,
      basis: "APPLIED_OR_AGREED",
      source: "REFERRAL",
      attestedById: recruiter.user.id,
      attestedAt: new Date(),
      noticeVersion: "2026-11",
    },
  });
  const other = await candidateAt(
    requisitionId,
    recruiter.user.id,
    "SOURCED",
    "Meera Pillai",
  );
  // Someone else, with their own details, who must be left alone.
  await prisma.candidate.update({
    where: { id: other.candidate.id },
    data: { email: "meera.pillai@example.net", phone: "9000000001" },
  });
  await prisma.cvDocument.update({
    where: { id: other.cv.id },
    data: { text: "MEERA PILLAI", redactedText: "[name]" },
  });
  await prisma.candidateScore.updateMany({
    where: { applicationId: other.application.id },
    data: { criteria: [] },
  });
  await prisma.duplicateLink.create({
    data: {
      cvId: other.cv.id,
      candidateId: candidate.id,
      kind: "FUZZY",
      status: "PENDING",
      reason: `Looks like ${name}`,
    },
  });
  await prisma.sampleReview.create({
    data: {
      weekStart: new Date("2026-11-02"),
      applicationId: application.id,
      verdict: "AI_RIGHT",
      note: `${name} was clearly a fit`,
      reviewedById: head.user.id,
      band: "STRONG",
      decision: "APPLICATION_SCREENED",
      requisitionNumber: 1,
    },
  });
  return { candidate, cv, application, other };
}

describe("erasing a candidate", () => {
  it("leaves no name, email or phone in any text column of any table", async () => {
    const { candidate } = await fullCandidate();
    const needles = ["Riya Sen", EMAIL, PHONE];
    expect((await findLeaks(needles)).length).toBeGreaterThan(3);

    const res = await erase(head.cookie, candidate.id, {
      reason: "CANDIDATE_REQUEST",
      confirmCode: candidate.code,
    });
    expect(res.status).toBe(200);
    expect(await findLeaks(needles)).toEqual([]);
  });

  it("covers a candidate from the CV corpus, whose CV text holds their details", async () => {
    const { cv, text } = (await textCorpus()).find(
      (x) => x.cv.email && x.cv.phone,
    )!;
    const batch = await prisma.uploadBatch.create({
      data: {
        requisitionId,
        uploadedById: recruiter.user.id,
        expectedCount: 1,
      },
    });
    const candidate = await prisma.candidate.create({
      data: {
        name: cv.name,
        email: cv.email,
        phone: cv.phone,
        skills: cv.skills,
      },
    });
    await prisma.cvDocument.create({
      data: {
        batchId: batch.id,
        requisitionId,
        candidateId: candidate.id,
        fileName: "corpus.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1,
        sha256: candidate.id,
        data: new Uint8Array([1]),
        text,
        redactedText: text,
        profile: { name: cv.name, email: cv.email },
        status: "PARSED",
      },
    });
    await prisma.application.create({
      data: {
        candidateId: candidate.id,
        requisitionId,
        stage: "SUBMITTED",
        submittedAt: new Date(),
        submissionNote: `Reach ${cv.name} on ${cv.phone}`,
      },
    });
    const needles = [cv.name, cv.email!, cv.phone!];
    expect(await findLeaks(needles)).not.toEqual([]);

    const res = await erase(head.cookie, candidate.id, {
      reason: "RETENTION_ENDED",
      confirmCode: candidate.code,
    });
    expect(res.status).toBe(200);
    expect(await findLeaks(needles)).toEqual([]);
  });

  it("looks at every text column the database has, new tables included", async () => {
    const tables = new Set((await textColumns()).map((c) => c.table_name));
    for (const table of [
      "Candidate",
      "CvDocument",
      "Application",
      "OutboundMessage",
      "InterviewSlot",
      "AuditEvent",
      "DeletionRecord",
      "SampleReview",
      "ConsentRecord",
    ]) {
      expect(tables.has(table), table).toBe(true);
    }
  });

  it("records the code, the reason and what was removed, and nothing personal", async () => {
    const { candidate } = await fullCandidate();
    await erase(head.cookie, candidate.id, {
      reason: "UPLOADED_BY_MISTAKE",
      confirmCode: candidate.code.toLowerCase(),
    });

    const counts = {
      cvs: 1,
      applications: 1,
      scores: 1,
      slots: 2,
      messages: 1,
      consentRecords: 1,
      duplicateLinks: 1,
    };
    const record = await prisma.deletionRecord.findFirstOrThrow();
    expect(record).toMatchObject({
      candidateCode: candidate.code,
      reason: "UPLOADED_BY_MISTAKE",
      deletedById: head.user.id,
      counts,
    });
    const event = await prisma.auditEvent.findFirstOrThrow({
      where: { action: "CANDIDATE_DELETED" },
    });
    expect(event).toMatchObject({
      actorId: head.user.id,
      entityId: candidate.id,
      meta: { code: candidate.code, reason: "UPLOADED_BY_MISTAKE", ...counts },
    });
    expect(
      await prisma.candidate.findUnique({ where: { id: candidate.id } }),
    ).toBeNull();
  });

  it("keeps the other candidate and their CV, and the review verdict without its note", async () => {
    const { candidate, application, other } = await fullCandidate();
    await erase(head.cookie, candidate.id, {
      reason: "CANDIDATE_REQUEST",
      confirmCode: candidate.code,
    });
    expect(
      await prisma.candidate.findUnique({ where: { id: other.candidate.id } }),
    ).not.toBeNull();
    expect(await prisma.cvDocument.count()).toBe(1);
    expect(await prisma.sampleReview.findFirstOrThrow()).toMatchObject({
      applicationId: null,
      verdict: "AI_RIGHT",
      note: null,
    });
    expect(
      await prisma.application.findUnique({ where: { id: application.id } }),
    ).toBeNull();
  });

  it("refuses a wrong confirmation code and removes nothing", async () => {
    const { candidate } = await fullCandidate();
    const res = await erase(head.cookie, candidate.id, {
      reason: "CANDIDATE_REQUEST",
      confirmCode: "CND-00000",
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/code/i);
    expect(await prisma.candidate.count()).toBe(2);
    expect(await prisma.deletionRecord.count()).toBe(0);
  });

  it.each([
    ["no reason", { confirmCode: "x" }],
    ["an unknown reason", { reason: "BORED", confirmCode: "x" }],
    ["no code", { reason: "CANDIDATE_REQUEST" }],
  ])("refuses a request with %s", async (_name, body) => {
    const { candidate } = await fullCandidate();
    const res = await erase(head.cookie, candidate.id, body);
    expect(res.status).toBe(400);
    expect(await prisma.candidate.count()).toBe(2);
  });

  it("answers 404 for a candidate that is not there", async () => {
    const res = await erase(head.cookie, "nope", {
      reason: "CANDIDATE_REQUEST",
      confirmCode: "CND-1",
    });
    expect(res.status).toBe(404);
  });

  it("is for the delivery head alone", async () => {
    const { candidate } = await fullCandidate();
    const body = { reason: "CANDIDATE_REQUEST", confirmCode: candidate.code };
    expect((await erase(recruiter.cookie, candidate.id, body)).status).toBe(
      403,
    );
    expect((await erase(kestrel.cookie, candidate.id, body)).status).toBe(403);
    const anonymous = await request(app)
      .delete(`/api/candidates/${candidate.id}`)
      .send(body);
    expect(anonymous.status).toBe(401);
    expect(await prisma.candidate.count()).toBe(2);
  });

  it("takes the candidate out of the client portal", async () => {
    const { candidate, application } = await fullCandidate();
    const list = `/api/portal/requisitions/${requisitionId}/candidates`;
    expect((await get(kestrel.cookie, list)).body.items).toHaveLength(1);

    await erase(head.cookie, candidate.id, {
      reason: "CANDIDATE_REQUEST",
      confirmCode: candidate.code,
    });
    expect((await get(kestrel.cookie, list)).body.items).toEqual([]);
    expect(
      (await get(kestrel.cookie, `/api/portal/applications/${application.id}`))
        .status,
    ).toBe(404);
  });
});

describe("jobs that were queued for erased data", () => {
  it("a parse job for an erased CV does nothing", async () => {
    const { candidate, cv } = await fullCandidate();
    await prisma.cvDocument.update({
      where: { id: cv.id },
      data: { status: "QUEUED" },
    });
    await eraseCandidate({
      candidateId: candidate.id,
      reason: "CANDIDATE_REQUEST",
      actorId: head.user.id,
    });
    const before = await prisma.candidate.count();
    await expect(processCv(cv.id)).resolves.toBeUndefined();
    expect(await prisma.candidate.count()).toBe(before);
    expect(
      await prisma.cvDocument.findUnique({ where: { id: cv.id } }),
    ).toBeNull();
  });

  it("a score job for an erased application does nothing", async () => {
    const { candidate, application } = await fullCandidate();
    await eraseCandidate({
      candidateId: candidate.id,
      reason: "CANDIDATE_REQUEST",
      actorId: head.user.id,
    });
    const ai = async () => {
      throw new Error("the model should not be asked");
    };
    await expect(
      processScore(application.id, { ai }, true),
    ).resolves.toBeUndefined();
    expect(await prisma.candidateScore.count()).toBe(1);
  });

  it("a score job already running when the candidate is erased leaves no score behind", async () => {
    const { candidate, application } = await fullCandidate();
    const ai = async () => {
      await eraseCandidate({
        candidateId: candidate.id,
        reason: "CANDIDATE_REQUEST",
        actorId: head.user.id,
      });
      return {
        verdicts: null,
        run: {
          model: "rules",
          outcome: "NOT_CONFIGURED" as const,
          latencyMs: 0,
          inputTokens: null,
          outputTokens: null,
          errorMessage: null,
        },
      };
    };
    await expect(
      processScore(application.id, { ai }, true),
    ).resolves.toBeUndefined();
    expect(
      await prisma.candidateScore.count({
        where: { applicationId: application.id },
      }),
    ).toBe(0);
    expect(
      await prisma.application.findUnique({ where: { id: application.id } }),
    ).toBeNull();
  });
});
