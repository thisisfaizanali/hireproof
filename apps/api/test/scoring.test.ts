import bcrypt from "bcryptjs";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderError, type ChatResult } from "../src/ai/llm";
import { app } from "../src/app";
import { Throttle } from "../src/cv/throttle";
import { prisma } from "../src/db";
import { aiScore } from "../src/score/ai";
import { processScore, type ScoreDeps } from "../src/score/job";
import { setScoreSender, type ScoreJob } from "../src/score/trigger";
import {
  addCv,
  createRequisition,
  deps,
  fakeClock,
  okReply,
  run,
} from "./cvHelpers";
import { PASSWORD, loginAs, resetDb } from "./helpers";

type Session = Awaited<ReturnType<typeof loginAs>>;
let recruiter: Session;
let requisitionId: string;
const sent: ScoreJob[] = [];

const ritika = "cvs/Ritika_Bansal_Resume.pdf";
const ritikaDocx = "cvs/Ritika Bansal - Updated Resume.docx";

beforeEach(async () => {
  await resetDb();
  sent.length = 0;
  setScoreSender(async (job) => void sent.push(job));
  recruiter = await loginAs("RECRUITER");
  requisitionId = (await createRequisition(recruiter.user.id)).id;
  await addScorecard(requisitionId);
});

afterAll(() => setScoreSender(undefined));

async function addScorecard(id: string) {
  await prisma.scorecard.create({
    data: {
      requisitionId: id,
      source: "MANUAL",
      status: "CONFIRMED",
      version: 1,
      experienceMinYears: 5,
      experienceMaxYears: 8,
      noticeMaxDays: 60,
      ctcMaxLpa: 26,
      locations: ["Noida"],
      criteria: {
        create: [
          { kind: "MUST_HAVE", label: "Java", position: 0 },
          { kind: "MUST_HAVE", label: "Spring Boot", position: 1 },
          { kind: "NICE_TO_HAVE", label: "Kafka", position: 2 },
          { kind: "NICE_TO_HAVE", label: "Docker", position: 3 },
        ],
      },
    },
  });
}

const profileReply = () =>
  okReply({
    name: "Ritika Bansal",
    currentRole: "Senior Java Developer",
    location: "Noida",
    totalExperienceYears: 6.5,
  });

// Parses a sample CV into a candidate with an application, as the upload job does.
async function parsed(path = ritika) {
  const cv = await addCv(path, requisitionId, recruiter.user.id);
  await run(cv.id, deps(vi.fn().mockResolvedValue(profileReply())));
  const row = await prisma.cvDocument.findUniqueOrThrow({
    where: { id: cv.id },
  });
  const application = await prisma.application.findFirstOrThrow({
    where: { candidateId: row.candidateId!, requisitionId },
  });
  return {
    cvId: cv.id,
    applicationId: application.id,
    candidateId: row.candidateId!,
  };
}

const JAVA = "Senior Java Developer, Cobalt Digital, Noida Feb 2023";
const BOOT = "Built REST APIs in Spring Boot for a loan origination platform";
const DOCKER = "Git, Jenkins, Docker";

const reply = (
  results: { id: string; verdict: string; quotes: string[] }[],
): ChatResult => ({
  content: JSON.stringify({ results }),
  inputTokens: 1200,
  outputTokens: 150,
});

const goodReply = () =>
  reply([
    { id: "c1", verdict: "MET", quotes: [JAVA] },
    { id: "c2", verdict: "MET", quotes: [BOOT] },
    { id: "c3", verdict: "NOT_FOUND", quotes: [] },
    { id: "c4", verdict: "PARTIAL", quotes: [DOCKER] },
  ]);

function scoreDeps(
  chat: ReturnType<typeof vi.fn>,
  model: string | null = "test-model",
) {
  const clock = fakeClock();
  const d: ScoreDeps = {
    ai: (criteria, text) =>
      aiScore(criteria, text, {
        chat: chat as never,
        throttle: new Throttle(clock),
        model,
      }),
  };
  return { deps: d, clock };
}

const scoresOf = (applicationId: string) =>
  prisma.candidateScore.findMany({
    where: { applicationId },
    orderBy: { scorecardVersion: "asc" },
  });

describe("scoring job", () => {
  it("queues the application when a CV finishes parsing", async () => {
    const { applicationId } = await parsed();
    expect(sent).toEqual([{ applicationId, force: true }]);
  });

  it("scores with the model, checks the quotes and records the run", async () => {
    const { applicationId } = await parsed();
    const chat = vi.fn().mockResolvedValue(goodReply());
    await processScore(applicationId, scoreDeps(chat).deps);

    const [score] = await scoresOf(applicationId);
    expect(score).toMatchObject({
      source: "AI",
      model: "test-model",
      scorecardVersion: 1,
      total: 85,
      band: "STRONG",
      mustHavesMet: 2,
      mustHavesTotal: 2,
      stale: false,
    });
    const criteria = score.criteria as {
      label: string;
      verdict: string;
      points: number;
      quotes: { verified: boolean }[];
    }[];
    expect(criteria.map((c) => [c.label, c.verdict, c.points])).toEqual([
      ["Java", "MET", 35],
      ["Spring Boot", "MET", 35],
      ["Kafka", "NOT_FOUND", 0],
      ["Docker", "PARTIAL", 5],
    ]);
    expect(criteria[0].quotes).toEqual([{ text: JAVA, verified: true }]);

    const runs = await prisma.aiRun.findMany({ where: { kind: "CV_SCORE" } });
    expect(runs).toMatchObject([
      {
        outcome: "OK",
        model: "test-model",
        inputTokens: 1200,
        outputTokens: 150,
        requisitionId,
      },
    ]);
    const application = await prisma.application.findUniqueOrThrow({
      where: { id: applicationId },
    });
    expect(application.scoringStartedAt).toBeNull();
  });

  it("sends the model the redacted CV and nothing that identifies the candidate", async () => {
    const { applicationId } = await parsed();
    const chat = vi.fn().mockResolvedValue(goodReply());
    await processScore(applicationId, scoreDeps(chat).deps);
    const prompt = chat.mock.calls[0][0]
      .map((m: { content: string }) => m.content)
      .join("\n");
    expect(prompt).toContain("<<<CV");
    expect(prompt).not.toMatch(/Ritika|Bansal|ritika\.bansal|90000 11001/i);
  });

  it("downgrades a quote that is not in the CV and flags it", async () => {
    const { applicationId } = await parsed();
    const chat = vi.fn().mockResolvedValue(
      reply([
        { id: "c1", verdict: "MET", quotes: [JAVA] },
        { id: "c2", verdict: "MET", quotes: [BOOT] },
        {
          id: "c3",
          verdict: "MET",
          quotes: ["Ran a 40 node Kafka cluster at Cobalt"],
        },
        { id: "c4", verdict: "NOT_FOUND", quotes: [] },
      ]),
    );
    await processScore(applicationId, scoreDeps(chat).deps);
    const [score] = await scoresOf(applicationId);
    const kafka = (
      score.criteria as {
        label: string;
        verdict: string;
        flag: string | null;
      }[]
    )[2];
    expect(kafka).toMatchObject({
      label: "Kafka",
      verdict: "NOT_FOUND",
      flag: "The AI cited text that is not in the CV",
    });
    expect(score.total).toBe(80);
    expect(score.flags.join(" ")).toContain("not in the CV (Kafka)");
  });

  it("falls back to rules when the model answers with invalid output twice", async () => {
    const { applicationId } = await parsed();
    const chat = vi.fn().mockResolvedValue({
      content: "not json",
      inputTokens: 900,
      outputTokens: 10,
    });
    await processScore(applicationId, scoreDeps(chat).deps);
    expect(chat).toHaveBeenCalledTimes(2);
    const [score] = await scoresOf(applicationId);
    expect(score).toMatchObject({ source: "RULES", model: null });
    expect(score.flags.join(" ")).toContain("Scored without AI");
    expect(
      await prisma.aiRun.findFirstOrThrow({ where: { kind: "CV_SCORE" } }),
    ).toMatchObject({
      outcome: "INVALID_OUTPUT",
      inputTokens: 1800,
    });
  });

  it("waits and retries after a 429, then uses the answer", async () => {
    const { applicationId } = await parsed();
    const chat = vi
      .fn()
      .mockRejectedValueOnce(
        new ProviderError("429: slow down", true, 1000, 429),
      )
      .mockResolvedValue(goodReply());
    const { deps: d, clock } = scoreDeps(chat);
    await processScore(applicationId, d);
    expect(clock.slept).toEqual([1000]);
    expect((await scoresOf(applicationId))[0]).toMatchObject({
      source: "AI",
      total: 85,
    });
  });

  it("scores by rules, never fails, when the provider keeps refusing", async () => {
    const { applicationId } = await parsed();
    const chat = vi
      .fn()
      .mockRejectedValue(
        new ProviderError("429: daily limit", true, 5_000_000, 429),
      );
    await processScore(applicationId, scoreDeps(chat).deps);
    expect((await scoresOf(applicationId))[0].source).toBe("RULES");
    expect(
      (await prisma.aiRun.findFirstOrThrow({ where: { kind: "CV_SCORE" } }))
        .outcome,
    ).toBe("PROVIDER_ERROR");
  });

  it("scores by rules when the AI is not configured", async () => {
    const { applicationId } = await parsed();
    const chat = vi.fn();
    await processScore(applicationId, scoreDeps(chat, null).deps);
    expect(chat).not.toHaveBeenCalled();
    const [score] = await scoresOf(applicationId);
    expect(score.source).toBe("RULES");
    const criteria = score.criteria as {
      label: string;
      verdict: string;
      quotes: { verified: boolean }[];
    }[];
    expect(criteria[1]).toMatchObject({ label: "Spring Boot", verdict: "MET" });
    expect(criteria.flatMap((c) => c.quotes).every((q) => q.verified)).toBe(
      true,
    );
    expect(
      (await prisma.aiRun.findFirstOrThrow({ where: { kind: "CV_SCORE" } }))
        .outcome,
    ).toBe("NOT_CONFIGURED");
  });

  it("leaves a finished score alone unless asked to score again", async () => {
    const { applicationId } = await parsed();
    const chat = vi.fn().mockResolvedValue(goodReply());
    const { deps: d } = scoreDeps(chat);
    await processScore(applicationId, d);
    await processScore(applicationId, d);
    expect(chat).toHaveBeenCalledTimes(1);
    await processScore(applicationId, d, true);
    expect(chat).toHaveBeenCalledTimes(2);
    expect(await scoresOf(applicationId)).toHaveLength(1);
  });

  it("does nothing without a confirmed scorecard", async () => {
    const { applicationId } = await parsed();
    await prisma.scorecard.update({
      where: { requisitionId },
      data: { status: "DRAFT" },
    });
    const chat = vi.fn().mockResolvedValue(goodReply());
    await processScore(applicationId, scoreDeps(chat).deps);
    expect(chat).not.toHaveBeenCalled();
    expect(await scoresOf(applicationId)).toEqual([]);
  });

  it("drops a score for a version that changed mid-call and queues the new one", async () => {
    const { applicationId } = await parsed();
    sent.length = 0;
    const chat = vi.fn().mockImplementationOnce(async () => {
      await prisma.scorecard.update({
        where: { requisitionId },
        data: { version: 2 },
      });
      return goodReply();
    });
    await processScore(applicationId, scoreDeps(chat).deps);
    expect(await scoresOf(applicationId)).toEqual([]);
    expect(sent).toEqual([{ applicationId, force: false }]);

    chat.mockResolvedValue(goodReply());
    await processScore(applicationId, scoreDeps(chat).deps);
    expect(
      (await scoresOf(applicationId)).map((s) => s.scorecardVersion),
    ).toEqual([2]);
  });
});

const get = (cookie: string, path: string) =>
  request(app).get(path).set("Cookie", cookie);
const post = (cookie: string, path: string, body: object = {}) =>
  request(app).post(path).set("Cookie", cookie).send(body);

async function confirmWith(labels: string[]) {
  const card = await prisma.scorecard.findUniqueOrThrow({
    where: { requisitionId },
    include: { criteria: { orderBy: { position: "asc" } } },
  });
  return request(app)
    .put(`/api/requisitions/${requisitionId}/scorecard`)
    .set("Cookie", recruiter.cookie)
    .send({
      criteria: labels.map((label, i) => ({
        ...(card.criteria[i] && { id: card.criteria[i].id }),
        kind: i < 2 ? "MUST_HAVE" : "NICE_TO_HAVE",
        label,
      })),
      experience: { minYears: 5, maxYears: 8 },
      notice: { maxDays: 60 },
      ctc: { maxLpa: 26 },
      locations: ["Noida"],
      confirm: true,
    });
}

describe("a changed scorecard", () => {
  it("marks older scores stale, re-queues them and never mixes versions", async () => {
    const { applicationId } = await parsed();
    await processScore(
      applicationId,
      scoreDeps(vi.fn().mockResolvedValue(goodReply())).deps,
    );
    const before = await get(
      recruiter.cookie,
      `/api/requisitions/${requisitionId}/candidates`,
    );
    expect(before.body).toMatchObject({
      ranked: true,
      progress: { scored: 1, total: 1 },
      items: [
        { rank: 1, scoreState: "SCORED", score: { total: 85, band: "STRONG" } },
      ],
    });

    sent.length = 0;
    const res = await confirmWith([
      "Java",
      "Spring Boot",
      "Kafka",
      "Kubernetes",
    ]);
    expect(res.status).toBe(200);
    expect(sent).toEqual([{ applicationId, force: false }]);
    expect((await scoresOf(applicationId))[0].stale).toBe(true);

    const during = await get(
      recruiter.cookie,
      `/api/requisitions/${requisitionId}/candidates`,
    );
    expect(during.body).toMatchObject({
      scorecardVersion: 2,
      progress: { scored: 0, total: 1 },
      items: [{ rank: null, score: null, scoreState: "RESCORING" }],
    });

    const chat = vi.fn().mockResolvedValue(
      reply([
        { id: "c1", verdict: "MET", quotes: [JAVA] },
        { id: "c2", verdict: "NOT_FOUND", quotes: [] },
        { id: "c3", verdict: "NOT_FOUND", quotes: [] },
        { id: "c4", verdict: "NOT_FOUND", quotes: [] },
      ]),
    );
    await processScore(applicationId, scoreDeps(chat).deps);
    const after = await get(
      recruiter.cookie,
      `/api/requisitions/${requisitionId}/candidates`,
    );
    expect(after.body.items).toHaveLength(1);
    expect(after.body.items[0].score).toMatchObject({
      total: 45,
      band: "WEAK",
    });
    expect(
      (await scoresOf(applicationId)).map((s) => [s.scorecardVersion, s.stale]),
    ).toEqual([
      [1, true],
      [2, false],
    ]);
  });
});

// Ranked list built straight from scores, so the order rules are tested alone.
describe("the ranked list", () => {
  async function entry(
    name: string,
    score: {
      band: "STRONG" | "POSSIBLE" | "WEAK";
      total: number;
      met: number;
    } | null,
    cv: Date | null = new Date(),
  ) {
    const candidate = await prisma.candidate.create({ data: { name } });
    const application = await prisma.application.create({
      data: { candidateId: candidate.id, requisitionId },
    });
    if (score) {
      await prisma.candidateScore.create({
        data: {
          applicationId: application.id,
          scorecardVersion: 1,
          total: score.total,
          band: score.band,
          mustHavesMet: score.met,
          mustHavesTotal: 3,
          experiencePoints: 10,
          criteria: [],
          flags: [],
          source: "AI",
        },
      });
    }
    if (cv) {
      const doc = await addCv(ritika, requisitionId, recruiter.user.id);
      await prisma.cvDocument.update({
        where: { id: doc.id },
        data: {
          candidateId: candidate.id,
          status: "PARSED",
          redactedText: "x",
          createdAt: cv,
        },
      });
    }
    return application.id;
  }

  const list = (cookie = recruiter.cookie, query = "") =>
    get(cookie, `/api/requisitions/${requisitionId}/candidates${query}`);
  const names = (body: { items: { name: string }[] }) =>
    body.items.map((i) => i.name);

  beforeEach(async () => {
    await entry("Weak 20", { band: "WEAK", total: 20, met: 0 });
    await entry("Possible 60", { band: "POSSIBLE", total: 60, met: 2 });
    await entry(
      "Strong 80 two",
      { band: "STRONG", total: 80, met: 2 },
      new Date("2026-01-01"),
    );
    await entry("Strong 80 three", { band: "STRONG", total: 80, met: 3 });
    await entry("Strong 90", { band: "STRONG", total: 90, met: 3 });
    await entry(
      "Strong 80 two newer",
      { band: "STRONG", total: 80, met: 2 },
      new Date("2026-06-01"),
    );
    await entry("Waiting", null, new Date("2026-03-01"));
    await entry("No CV", null, null);
  });

  it("orders by band, then score, then must-haves met, then newest CV, with unscored last, newest first", async () => {
    const res = await list();
    expect(res.status).toBe(200);
    expect(names(res.body)).toEqual([
      "Strong 90",
      "Strong 80 three",
      "Strong 80 two newer",
      "Strong 80 two",
      "Possible 60",
      "Weak 20",
      "No CV",
      "Waiting",
    ]);
    expect(res.body.items.map((i: { rank: number | null }) => i.rank)).toEqual([
      1,
      2,
      3,
      4,
      5,
      6,
      null,
      null,
    ]);
    expect(
      res.body.items.slice(6).map((i: { scoreState: string }) => i.scoreState),
    ).toEqual(["NO_CV", "WAITING"]);
    expect(res.body.progress).toEqual({ scored: 6, total: 7 });
  });

  it("filters by band, unscored and stage", async () => {
    expect(
      names((await list(recruiter.cookie, "?band=STRONG")).body),
    ).toHaveLength(4);
    expect(
      names((await list(recruiter.cookie, "?band=UNSCORED")).body),
    ).toEqual(["No CV", "Waiting"]);
    const rows = (await list()).body.items as {
      name: string;
      applicationId: string;
    }[];
    const target = rows.find((r) => r.name === "Weak 20")!;
    await prisma.application.update({
      where: { id: target.applicationId },
      data: { stage: "REJECTED" },
    });
    expect(
      names((await list(recruiter.cookie, "?stage=REJECTED")).body),
    ).toEqual(["Weak 20"]);
    expect((await list(recruiter.cookie, "?band=nonsense")).status).toBe(400);
  });

  it("is not ranked until the scorecard is confirmed", async () => {
    await prisma.scorecard.update({
      where: { requisitionId },
      data: { status: "DRAFT" },
    });
    const res = await list();
    expect(res.body).toMatchObject({ ranked: false, progress: null });
    expect(
      res.body.items.every(
        (i: { rank: number | null; scoreState: string | null }) =>
          i.rank === null && i.scoreState === null,
      ),
    ).toBe(true);
  });

  it("is the same for a delivery head", async () => {
    const head = await loginAs("DELIVERY_HEAD");
    expect(names((await list(head.cookie)).body)[0]).toBe("Strong 90");
  });
});

async function secondRecruiter(): Promise<Session> {
  const user = await prisma.user.create({
    data: {
      email: "second.recruiter@example.test",
      name: "Second Recruiter",
      role: "RECRUITER",
      passwordHash: bcrypt.hashSync(PASSWORD, 4),
    },
  });
  const res = await request(app)
    .post("/api/auth/login")
    .send({ email: user.email, password: PASSWORD });
  const cookie = (res.headers["set-cookie"] as unknown as string[])[0].split(
    ";",
  )[0];
  return { user, cookie };
}

describe("opening a CV and the screening gate", () => {
  const GATE = "Open the CV before marking this candidate screened.";

  it("refuses to screen a candidate whose CV was not opened", async () => {
    const { applicationId } = await parsed();
    const res = await post(
      recruiter.cookie,
      `/api/applications/${applicationId}/screen`,
    );
    expect(res.status).toBe(409);
    expect(res.body.error).toBe(GATE);
    expect(
      (
        await prisma.application.findUniqueOrThrow({
          where: { id: applicationId },
        })
      ).stage,
    ).toBe("SOURCED");
  });

  it("serves the original with safe headers and logs the view", async () => {
    const { cvId, candidateId } = await parsed();
    const res = await get(
      recruiter.cookie,
      `/api/cvs/${cvId}/file?requisition=${requisitionId}`,
    ).responseType("blob");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^application\/pdf/);
    expect(res.headers["content-disposition"]).toBe(
      `inline; filename="Ritika_Bansal_Resume.pdf"; filename*=UTF-8''Ritika_Bansal_Resume.pdf`,
    );
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["cache-control"]).toBe("private, no-store");
    expect(res.headers["content-security-policy"]).toContain(
      "default-src 'none'",
    );
    expect(res.body.subarray(0, 4).toString()).toBe("%PDF");
    expect(
      await prisma.auditEvent.findFirstOrThrow({
        where: { action: "CV_VIEWED" },
      }),
    ).toMatchObject({
      actorId: recruiter.user.id,
      entityType: "CvDocument",
      entityId: cvId,
      meta: { candidateId, requisitionId },
    });
  });

  it("encodes an unusual file name in the header", async () => {
    const { cvId } = await parsed();
    await prisma.cvDocument.update({
      where: { id: cvId },
      data: { fileName: 'Rítika "x"\r\nSet-Cookie: a=b.pdf' },
    });
    const res = await get(
      recruiter.cookie,
      `/api/cvs/${cvId}/file`,
    ).responseType("blob");
    expect(res.headers["content-disposition"]).not.toMatch(/[\r\n]/);
    expect(res.headers["content-disposition"]).toContain(
      'filename="R_tika _x___Set-Cookie_ a_b.pdf"',
    );
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("lets the same recruiter screen after opening the file", async () => {
    const { applicationId, cvId } = await parsed();
    await processScore(
      applicationId,
      scoreDeps(vi.fn().mockResolvedValue(goodReply())).deps,
    );
    await get(recruiter.cookie, `/api/cvs/${cvId}/file`);
    const res = await post(
      recruiter.cookie,
      `/api/applications/${applicationId}/screen`,
    );
    expect(res.status).toBe(200);
    const row = await prisma.application.findUniqueOrThrow({
      where: { id: applicationId },
    });
    expect(row).toMatchObject({
      stage: "SCREENED",
      decidedById: recruiter.user.id,
    });
    expect(
      await prisma.auditEvent.findFirstOrThrow({
        where: { action: "APPLICATION_SCREENED" },
      }),
    ).toMatchObject({
      actorId: recruiter.user.id,
      entityId: applicationId,
      meta: {
        band: "STRONG",
        total: 85,
        scoreSource: "AI",
        scorecardVersion: 1,
        stale: false,
      },
    });
    expect(
      (
        await post(
          recruiter.cookie,
          `/api/applications/${applicationId}/screen`,
        )
      ).status,
    ).toBe(409);
  });

  it("counts the text view as opening the CV", async () => {
    const { applicationId, cvId } = await parsed();
    const text = await get(recruiter.cookie, `/api/cvs/${cvId}/text`);
    expect(text.status).toBe(200);
    expect(text.body.text).toContain("Ritika Bansal");
    expect(text.headers["cache-control"]).toBe("private, no-store");
    expect(
      (
        await post(
          recruiter.cookie,
          `/api/applications/${applicationId}/screen`,
        )
      ).status,
    ).toBe(200);
  });

  it("does not count another recruiter's view", async () => {
    const { applicationId, cvId } = await parsed();
    const other = await secondRecruiter();
    await get(other.cookie, `/api/cvs/${cvId}/file`);
    const res = await post(
      recruiter.cookie,
      `/api/applications/${applicationId}/screen`,
    );
    expect(res.status).toBe(409);
    expect(res.body.error).toBe(GATE);
  });

  it("needs the newest CV opened, not an older one", async () => {
    const first = await parsed();
    const second = await addCv(ritikaDocx, requisitionId, recruiter.user.id);
    await run(second.id, deps(vi.fn().mockResolvedValue(profileReply())));
    expect(
      (await prisma.cvDocument.findUniqueOrThrow({ where: { id: second.id } }))
        .candidateId,
    ).toBe(first.candidateId);

    await get(recruiter.cookie, `/api/cvs/${first.cvId}/file`);
    expect(
      (
        await post(
          recruiter.cookie,
          `/api/applications/${first.applicationId}/screen`,
        )
      ).status,
    ).toBe(409);
    await get(recruiter.cookie, `/api/cvs/${second.id}/text`);
    expect(
      (
        await post(
          recruiter.cookie,
          `/api/applications/${first.applicationId}/screen`,
        )
      ).status,
    ).toBe(200);
  });

  it("explains a missing CV and a file with no text", async () => {
    expect((await get(recruiter.cookie, "/api/cvs/nope/file")).status).toBe(
      404,
    );
    const { cvId } = await parsed();
    await prisma.cvDocument.update({
      where: { id: cvId },
      data: { text: null },
    });
    const res = await get(recruiter.cookie, `/api/cvs/${cvId}/text`);
    expect(res.status).toBe(404);
  });
});

describe("rejecting, reopening and scoring again", () => {
  it("needs a reason, and a note for Other", async () => {
    const { applicationId } = await parsed();
    const url = `/api/applications/${applicationId}/reject`;
    expect((await post(recruiter.cookie, url, {})).status).toBe(400);
    expect(
      (await post(recruiter.cookie, url, { reason: "BORED" })).status,
    ).toBe(400);
    const other = await post(recruiter.cookie, url, { reason: "OTHER" });
    expect(other.status).toBe(400);
    expect(other.body.error).toBe("Say why in a few words");
  });

  it("rejects with the AI band on the audit event, and can be undone", async () => {
    const { applicationId } = await parsed();
    await processScore(
      applicationId,
      scoreDeps(vi.fn().mockResolvedValue(goodReply())).deps,
    );
    const res = await post(
      recruiter.cookie,
      `/api/applications/${applicationId}/reject`,
      { reason: "NOTICE_PERIOD" },
    );
    expect(res.status).toBe(200);
    expect(
      await prisma.application.findUniqueOrThrow({
        where: { id: applicationId },
      }),
    ).toMatchObject({
      stage: "REJECTED",
      rejectReason: "NOTICE_PERIOD",
      decidedById: recruiter.user.id,
    });
    expect(
      await prisma.auditEvent.findFirstOrThrow({
        where: { action: "APPLICATION_REJECTED" },
      }),
    ).toMatchObject({
      meta: { band: "STRONG", reason: "NOTICE_PERIOD", fromStage: "SOURCED" },
    });
    expect(
      (
        await post(
          recruiter.cookie,
          `/api/applications/${applicationId}/reject`,
          { reason: "CTC" },
        )
      ).status,
    ).toBe(409);

    const back = await post(
      recruiter.cookie,
      `/api/applications/${applicationId}/reopen`,
    );
    expect(back.status).toBe(200);
    expect(
      await prisma.application.findUniqueOrThrow({
        where: { id: applicationId },
      }),
    ).toMatchObject({
      stage: "SOURCED",
      rejectReason: null,
    });
    expect(
      await prisma.auditEvent.count({
        where: { action: "APPLICATION_REOPENED" },
      }),
    ).toBe(1);
    expect(
      (
        await post(
          recruiter.cookie,
          `/api/applications/${applicationId}/reopen`,
        )
      ).status,
    ).toBe(409);
  });

  it("keeps the note for Other", async () => {
    const { applicationId } = await parsed();
    await post(recruiter.cookie, `/api/applications/${applicationId}/reject`, {
      reason: "OTHER",
      note: "Withdrew interest",
    });
    expect(
      (
        await prisma.application.findUniqueOrThrow({
          where: { id: applicationId },
        })
      ).rejectNote,
    ).toBe("Withdrew interest");
  });

  it("queues a forced re-score, but only on a confirmed scorecard", async () => {
    const { applicationId } = await parsed();
    sent.length = 0;
    expect(
      (
        await post(
          recruiter.cookie,
          `/api/applications/${applicationId}/rescore`,
        )
      ).status,
    ).toBe(202);
    expect(sent).toEqual([{ applicationId, force: true }]);
    await prisma.scorecard.update({
      where: { requisitionId },
      data: { status: "DRAFT" },
    });
    expect(
      (
        await post(
          recruiter.cookie,
          `/api/applications/${applicationId}/rescore`,
        )
      ).status,
    ).toBe(409);
  });
});

describe("the score breakdown", () => {
  it("returns the criteria, quotes, points, flags and formula", async () => {
    const { applicationId, cvId } = await parsed();
    const waiting = await get(
      recruiter.cookie,
      `/api/applications/${applicationId}/score`,
    );
    expect(waiting.body).toMatchObject({
      state: "WAITING",
      score: null,
      application: { cvId, cvViewed: false },
    });

    await processScore(
      applicationId,
      scoreDeps(vi.fn().mockResolvedValue(goodReply())).deps,
    );
    const res = await get(
      recruiter.cookie,
      `/api/applications/${applicationId}/score`,
    );
    expect(res.status).toBe(200);
    expect(res.body.state).toBe("SCORED");
    expect(res.body.score).toMatchObject({
      total: 85,
      band: "STRONG",
      cvId,
      experiencePoints: 10,
      experienceMaxPoints: 10,
      formula: { mustHave: 70, niceToHave: 20, experience: 10 },
    });
    expect(res.body.score.formulaText).toMatch(
      /^Must-haves 70, nice-to-haves 20, experience 10\./,
    );
    expect(res.body.score.criteria[0].quotes[0]).toEqual({
      text: JAVA,
      verified: true,
    });
    expect(res.body.application.requisition.id).toBe(requisitionId);

    await get(recruiter.cookie, `/api/cvs/${cvId}/file`);
    expect(
      (await get(recruiter.cookie, `/api/applications/${applicationId}/score`))
        .body.application.cvViewed,
    ).toBe(true);
  });

  it("lists the score and the CV to open on the candidate profile", async () => {
    const { applicationId, candidateId, cvId } = await parsed();
    await processScore(
      applicationId,
      scoreDeps(vi.fn().mockResolvedValue(goodReply())).deps,
    );
    const res = await get(recruiter.cookie, `/api/candidates/${candidateId}`);
    expect(res.body.applications[0]).toMatchObject({
      id: applicationId,
      cvId,
      score: { total: 85, band: "STRONG" },
    });
  });
});

describe("access to scoring", () => {
  const routes: [string, string][] = [
    ["get", "/api/applications/x/score"],
    ["get", "/api/cvs/x/file"],
    ["get", "/api/cvs/x/text"],
    ["post", "/api/applications/x/screen"],
    ["post", "/api/applications/x/reject"],
    ["post", "/api/applications/x/reopen"],
    ["post", "/api/applications/x/rescore"],
  ];

  it.each(routes)(
    "a hiring manager gets 403 from %s %s",
    async (method, path) => {
      const hm = await loginAs("CLIENT_HM");
      const res = await request(app)
        [method as "get" | "post"](path)
        .set("Cookie", hm.cookie)
        .send({});
      expect(res.status).toBe(403);
    },
  );

  it.each(routes)("a visitor gets 401 from %s %s", async (method, path) => {
    const res = await request(app)[method as "get" | "post"](path).send({});
    expect(res.status).toBe(401);
  });

  it.each(routes.filter(([m]) => m === "post"))(
    "a delivery head gets 403 from %s %s",
    async (method, path) => {
      const head = await loginAs("DELIVERY_HEAD");
      const res = await request(app)
        [method as "post"](path)
        .set("Cookie", head.cookie)
        .send({ reason: "CTC" });
      expect(res.status).toBe(403);
    },
  );

  it("lets a delivery head read the breakdown and open the CV, and logs the view", async () => {
    const { applicationId, cvId } = await parsed();
    await processScore(
      applicationId,
      scoreDeps(vi.fn().mockResolvedValue(goodReply())).deps,
    );
    const head = await loginAs("DELIVERY_HEAD");
    expect(
      (await get(head.cookie, `/api/applications/${applicationId}/score`))
        .status,
    ).toBe(200);
    expect((await get(head.cookie, `/api/cvs/${cvId}/file`)).status).toBe(200);
    expect((await get(head.cookie, `/api/cvs/${cvId}/text`)).status).toBe(200);
    expect(
      await prisma.auditEvent.count({
        where: { action: "CV_VIEWED", actorId: head.user.id },
      }),
    ).toBe(2);
    expect(
      (
        await prisma.application.findUniqueOrThrow({
          where: { id: applicationId },
        })
      ).stage,
    ).toBe("SOURCED");
  });
});
