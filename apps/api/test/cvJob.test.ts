import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderError } from "../src/ai/llm";
import { stuckCvIds } from "../src/cv/job";
import { prisma } from "../src/db";
import { addCv, createRequisition, deps, okReply, run } from "./cvHelpers";
import { createUser, resetDb } from "./helpers";

let ownerId: string;
let requisitionId: string;

beforeEach(async () => {
  await resetDb();
  ownerId = (await createUser("RECRUITER")).id;
  requisitionId = (await createRequisition(ownerId)).id;
});

const ritika = "cvs/Ritika_Bansal_Resume.pdf";
const aiReply = () =>
  okReply({
    name: "Ritika Bansal",
    currentRole: "Senior Java Developer",
    location: "Noida",
    totalExperienceYears: 6.5,
  });

const cvOf = (id: string) =>
  prisma.cvDocument.findUniqueOrThrow({
    where: { id },
    include: { candidate: true },
  });

describe("job handler", () => {
  it("parses a CV with the AI, creating a candidate and an application", async () => {
    const cv = await addCv(ritika, requisitionId, ownerId);
    await run(cv.id, deps(vi.fn().mockResolvedValue(aiReply())));

    const row = await cvOf(cv.id);
    expect(row.status).toBe("PARSED");
    expect(row.parseSource).toBe("AI");
    expect(row.textSource).toBe("TEXT_LAYER");
    expect(row.redactedText).not.toContain("ritika.bansal@example.com");
    expect(row.redactedText).toContain("Spring Boot");
    expect(row.candidate).toMatchObject({
      name: "Ritika Bansal",
      email: "ritika.bansal@example.com",
      phone: "9000011001",
      currentRole: "Senior Java Developer",
      location: "Noida",
      noticeDays: 60,
    });
    expect(row.candidate!.code).toMatch(/^CND-\d{5}$/);
    expect(Number(row.candidate!.totalExperienceYears)).toBe(6.5);
    expect(
      await prisma.application.findMany({ where: { requisitionId } }),
    ).toMatchObject([{ candidateId: row.candidateId, stage: "SOURCED" }]);
    const runs = await prisma.aiRun.findMany({ where: { kind: "CV_PARSE" } });
    expect(runs).toMatchObject([
      { outcome: "OK", model: "test-model", inputTokens: 700 },
    ]);
  });

  it("falls back to rules when the AI answers with invalid output twice", async () => {
    const cv = await addCv(ritika, requisitionId, ownerId);
    const chat = vi.fn().mockResolvedValue({
      content: "not json",
      inputTokens: 1,
      outputTokens: 1,
    });
    await run(cv.id, deps(chat));

    const row = await cvOf(cv.id);
    expect(chat).toHaveBeenCalledTimes(2);
    expect(row.parseSource).toBe("RULES");
    expect(row.status).toBe("NEEDS_REVIEW");
    expect(row.reviewReasons).toContain(
      "Parsed without AI, check name and role",
    );
    expect(row.candidate!.name).toBe("Ritika Bansal");
    const [aiRun] = await prisma.aiRun.findMany();
    expect(aiRun.outcome).toBe("INVALID_OUTPUT");
  });

  it("waits and retries after a 429, then uses the answer", async () => {
    const cv = await addCv(ritika, requisitionId, ownerId);
    const chat = vi
      .fn()
      .mockRejectedValueOnce(
        new ProviderError("429: slow down", true, 4000, 429),
      )
      .mockResolvedValue(aiReply());
    await run(cv.id, deps(chat));

    expect(chat).toHaveBeenCalledTimes(2);
    const row = await cvOf(cv.id);
    expect(row.parseSource).toBe("AI");
    expect(row.status).toBe("PARSED");
  });

  it("falls back to rules when the provider keeps refusing", async () => {
    const cv = await addCv(ritika, requisitionId, ownerId);
    const chat = vi
      .fn()
      .mockRejectedValue(new ProviderError("429: slow down", true, 1000, 429));
    await run(cv.id, deps(chat));

    const row = await cvOf(cv.id);
    expect(row.status).toBe("NEEDS_REVIEW");
    expect(row.parseSource).toBe("RULES");
    const [aiRun] = await prisma.aiRun.findMany();
    expect(aiRun.outcome).toBe("PROVIDER_ERROR");
  });

  it("parses through rules alone when the AI is not configured", async () => {
    const cv = await addCv(ritika, requisitionId, ownerId);
    const chat = vi.fn();
    await run(cv.id, deps(chat, null));

    expect(chat).not.toHaveBeenCalled();
    const row = await cvOf(cv.id);
    expect(row.parseSource).toBe("RULES");
    expect(row.reviewReasons).toEqual([
      "Parsed without AI, check name and role",
    ]);
    expect(row.candidate).toMatchObject({
      name: "Ritika Bansal",
      currentRole: "Senior Java Developer",
      location: "Noida",
    });
    const [aiRun] = await prisma.aiRun.findMany();
    expect(aiRun.outcome).toBe("NOT_CONFIGURED");
  });

  it("does not trust a name the model made up", async () => {
    const cv = await addCv(
      "cvs/Rahul_Mehrotra_Java.pdf",
      requisitionId,
      ownerId,
    );
    const chat = vi
      .fn()
      .mockResolvedValue(
        okReply({ name: "Top Candidate", currentRole: "CEO" }),
      );
    await run(cv.id, deps(chat));

    const row = await cvOf(cv.id);
    expect(row.candidate!.name).toBe("Rahul Mehrotra");
    expect(row.candidate!.currentRole).toBe("Java Developer");
    expect(row.reviewReasons.join(" ")).toMatch(/name/);
  });

  it("sends the model no email, phone or personal details", async () => {
    const cv = await addCv(
      "cvs/Farhan_Qureshi_DotNet_CV.docx",
      requisitionId,
      ownerId,
    );
    const chat = vi.fn().mockResolvedValue(okReply({ name: "Farhan Qureshi" }));
    await run(cv.id, deps(chat));

    const sent = JSON.stringify(chat.mock.calls[0][0]);
    expect(sent).toContain("FARHAN QURESHI");
    expect(sent).not.toContain("farhan.qureshi@example.in");
    expect(sent).not.toContain("11006");
    expect(sent).not.toContain("Date of Birth");
    expect(sent).not.toContain("Mohammed Yusuf");
  });

  it("marks a damaged file as failed with a plain reason", async () => {
    const cv = await addCv(
      "edge/Vandana_Rawal_Resume.pdf",
      requisitionId,
      ownerId,
    );
    await run(cv.id, deps(vi.fn()));
    expect(await cvOf(cv.id)).toMatchObject({
      status: "FAILED",
      failureReason: "This file is damaged and cannot be opened.",
      candidateId: null,
    });
  });

  it("does nothing when the CV is no longer queued", async () => {
    const cv = await addCv(ritika, requisitionId, ownerId);
    await prisma.cvDocument.update({
      where: { id: cv.id },
      data: { status: "PARSING" },
    });
    const chat = vi.fn();
    await run(cv.id, deps(chat));
    expect(chat).not.toHaveBeenCalled();
  });

  it("puts CVs left mid-run back in the queue after a restart", async () => {
    const a = await addCv(ritika, requisitionId, ownerId);
    const b = await addCv(ritika, requisitionId, ownerId);
    await prisma.cvDocument.update({
      where: { id: a.id },
      data: { status: "OCR" },
    });
    expect(await stuckCvIds()).toEqual([a.id]);
    expect((await cvOf(a.id)).status).toBe("QUEUED");
    expect((await cvOf(b.id)).status).toBe("QUEUED");
  });
});

describe("duplicates in the job", () => {
  const ai = (name: string) => vi.fn().mockResolvedValue(okReply({ name }));

  it("attaches the same bytes to the existing candidate without a new parse", async () => {
    const first = await addCv(ritika, requisitionId, ownerId);
    await run(first.id, deps(ai("Ritika Bansal")));
    const second = await addCv(ritika, requisitionId, ownerId);
    const chat = ai("Ritika Bansal");
    await run(second.id, deps(chat));

    expect(chat).not.toHaveBeenCalled();
    const row = await cvOf(second.id);
    expect(row.status).toBe("DUPLICATE_FILE");
    expect(row.candidateId).toBe((await cvOf(first.id)).candidateId);
    expect(await prisma.candidate.count()).toBe(1);
    expect(await prisma.duplicateLink.findMany()).toMatchObject([
      { kind: "EXACT_FILE", status: "AUTO_MERGED" },
    ]);
  });

  it("attaches a CV with the same email to the existing candidate", async () => {
    const first = await addCv(ritika, requisitionId, ownerId);
    await run(first.id, deps(ai("Ritika Bansal")));
    const second = await addCv(
      "cvs/Ritika Bansal - Updated Resume.docx",
      requisitionId,
      ownerId,
    );
    await run(second.id, deps(ai("Ritika Bansal")));

    expect(await prisma.candidate.count()).toBe(1);
    expect(
      await prisma.cvDocument.count({ where: { candidateId: { not: null } } }),
    ).toBe(2);
    expect(await prisma.duplicateLink.findMany()).toMatchObject([
      { kind: "CONTACT", status: "AUTO_MERGED", reason: "Same email address" },
    ]);
    expect(await prisma.application.count()).toBe(1);
  });

  it("attaches a CV with the same phone and keeps fields the newer CV lacks", async () => {
    const first = await addCv(
      "cvs/Tanvi Joshi Resume 2026.pdf",
      requisitionId,
      ownerId,
    );
    await run(first.id, deps(ai("Tanvi Joshi")));
    const second = await addCv(
      "cvs/TanviJoshi_CV_old.pdf",
      requisitionId,
      ownerId,
    );
    await run(second.id, deps(ai("Tanvi Joshi")));

    const candidate = await prisma.candidate.findFirstOrThrow();
    expect(await prisma.candidate.count()).toBe(1);
    expect(Number(candidate.currentCtcLpa)).toBe(19);
    expect(await prisma.duplicateLink.findMany()).toMatchObject([
      { kind: "CONTACT", reason: "Same phone number" },
    ]);
  });

  it("makes a pending link, not a merge, for the same name with a similar CV", async () => {
    const first = await addCv(
      "cvs/CV - Rohit Saxena (2024).docx",
      requisitionId,
      ownerId,
    );
    await run(first.id, deps(ai("Rohit Saxena")));
    const second = await addCv(
      "cvs/Rohit_Saxena_Resume_latest.pdf",
      requisitionId,
      ownerId,
    );
    await run(second.id, deps(ai("Rohit Saxena")));

    expect(await prisma.candidate.count()).toBe(2);
    const [link] = await prisma.duplicateLink.findMany();
    expect(link).toMatchObject({ kind: "FUZZY", status: "PENDING" });
    expect(link.similarity).toBeGreaterThan(0.5);
    expect(link.candidateId).toBe((await cvOf(first.id)).candidateId);
  });
});
