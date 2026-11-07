import bcrypt from "bcryptjs";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DEMO_USERS, type AiOutcome } from "@hireproof/shared";
import { rulesScorecard } from "../src/ai/rules";
import { aiProfile } from "../src/cv/aiProfile";
import { persistParsed } from "../src/cv/job";
import { parseCv, type ParsedCv } from "../src/cv/parse";
import {
  criteriaRows,
  scorecardData,
  type SeedExtraction,
} from "../src/requisitions";
import { ASOF, cvTruth, readSample } from "../scripts/cvCorpus";
import {
  fixtureVerdicts,
  poolFor,
  readScoreFixture,
  reviewedScorecard,
} from "../scripts/scoreCorpus";
import { audit } from "../src/audit";
import { scorecardHash } from "../src/scorecardHash";
import { processScore, scorableCv } from "../src/score/job";
import { readJd, truth } from "../scripts/jds";
import { prisma } from "../src/db";
import type { Industry } from "../src/generated/prisma/client";

const CLIENTS: { id: string; name: string; industry: Industry }[] = [
  { id: "client_kestrel", name: "Kestrel Infotech", industry: "IT_SERVICES" },
  {
    id: "client_sahyadri",
    name: "Sahyadri Finserv",
    industry: "BANKING_BACK_OFFICE",
  },
  { id: "client_marigold", name: "Marigold Retail", industry: "RETAIL" },
];

// One requisition per sample JD. The first two are reviewed and open; the others
// stay drafts so their ambiguities are visible.
const SEEDED: Record<string, { confirmed: boolean; owner: number }> = {
  "kestrel-senior-java": { confirmed: true, owner: 0 },
  "sahyadri-kyc-analyst": { confirmed: true, owner: 1 },
  "marigold-store-ops": { confirmed: false, owner: 0 },
  "kestrel-java-developer": { confirmed: false, owner: 1 },
};

async function seedRequisitions() {
  const fixturePath = resolve(__dirname, "fixtures/scorecards.json");
  const fixture = existsSync(fixturePath)
    ? (JSON.parse(readFileSync(fixturePath, "utf8")) as {
        model: string;
        scorecards: Record<string, SeedExtraction>;
      })
    : null;
  if (!fixture) {
    console.log(
      "No captured scorecards found; seeding with the rules extractor.",
    );
  }
  const recruiters = await prisma.user.findMany({
    where: {
      role: "RECRUITER",
      email: { in: DEMO_USERS.map((u) => u.email) },
    },
    orderBy: { email: "asc" },
  });

  for (const jd of truth) {
    const plan = SEEDED[jd.key];
    const client = CLIENTS.find((c) => c.name === jd.client);
    const file = jd.file.split("/").pop()!;
    if (!plan || !client) continue;
    if (await prisma.requisition.findFirst({ where: { jdFileName: file } }))
      continue;

    const jdText = await readJd(jd.file);
    const captured = fixture?.scorecards[jd.key];
    const extraction: SeedExtraction = captured
      ? { ...captured, model: fixture!.model }
      : { scorecard: rulesScorecard(jdText), source: "RULES", model: null };
    const owner = recruiters[plan.owner % recruiters.length];

    if (plan.confirmed) {
      extraction.scorecard = reviewedScorecard(extraction.scorecard, jd);
    }

    await prisma.requisition.create({
      data: {
        clientId: client.id,
        ownerId: owner.id,
        title: jd.title,
        jdText,
        jdFileName: file,
        status: plan.confirmed ? "OPEN" : "DRAFT",
        scorecard: {
          create: {
            ...scorecardData(extraction),
            ...(plan.confirmed && {
              status: "CONFIRMED" as const,
              version: 1,
              confirmedAt: new Date(),
              confirmedById: owner.id,
              contentHash: scorecardHash({
                criteria: extraction.scorecard.criteria,
                experienceMinYears: extraction.scorecard.experience.minYears,
                experienceMaxYears: extraction.scorecard.experience.maxYears,
                noticeMaxDays: extraction.scorecard.notice.maxDays,
                ctcMaxLpa: extraction.scorecard.ctc.maxLpa,
                locations: extraction.scorecard.locations.values,
              }),
            }),
            criteria: { create: criteriaRows(extraction) },
          },
        },
      },
    });
  }
}

// The brief names three candidates; their codes are fixed so the demo matches it.
const BRIEF_CODES = new Set(["CND-91022", "CND-91047", "CND-91088"]);

type Fixture = {
  model: string | null;
  parses: Record<string, ParsedCv>;
};

async function seedCandidates() {
  const fixturePath = resolve(__dirname, "fixtures/cv-parses.json");
  const fixture: Fixture | null = existsSync(fixturePath)
    ? JSON.parse(readFileSync(fixturePath, "utf8"))
    : null;
  if (!fixture) {
    console.log(
      "No captured CV parses found; parsing text CVs with rules only (scans are skipped).",
    );
  }

  for (const jd of truth) {
    const file = jd.file.split("/").pop()!;
    const requisition = await prisma.requisition.findFirst({
      where: { jdFileName: file },
    });
    if (!requisition) continue;
    if (
      await prisma.uploadBatch.findFirst({
        where: { requisitionId: requisition.id },
      })
    ) {
      continue;
    }
    const pool = poolFor(jd.key);
    if (pool.length === 0) continue;

    const batch = await prisma.uploadBatch.create({
      data: {
        requisitionId: requisition.id,
        uploadedById: requisition.ownerId,
        expectedCount: pool.length,
      },
    });
    for (const cv of pool) {
      const bytes = readSample(cv.file);
      const name = cv.file.split("/").pop()!;
      let parsed = fixture?.parses[cv.file];
      if (!parsed) {
        try {
          parsed = await parseCv(bytes, name, {
            ai: (text) => aiProfile(text, { model: null }),
            today: ASOF,
            ocr: async () => {
              throw new Error("OCR is not used when seeding");
            },
          });
        } catch {
          console.log(`Skipped ${cv.file}: needs the captured parse.`);
          continue;
        }
      }
      const row = await prisma.cvDocument.create({
        data: {
          batchId: batch.id,
          requisitionId: requisition.id,
          fileName: name,
          mimeType: name.endsWith(".pdf")
            ? "application/pdf"
            : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          sizeBytes: bytes.length,
          sha256: createHash("sha256").update(bytes).digest("hex"),
          data: new Uint8Array(bytes),
        },
      });
      await persistParsed(row, parsed);
    }
  }

  for (const cv of cvTruth) {
    if (!BRIEF_CODES.has(cv.candidateId)) continue;
    const row = await prisma.cvDocument.findFirst({
      where: { fileName: cv.file.split("/").pop()! },
    });
    if (row?.candidateId) {
      await prisma.candidate.update({
        where: { id: row.candidateId },
        data: { code: cv.candidateId },
      });
    }
  }
}

// Scores come from the captured model answers, run through the same evidence
// check and formula as a live score. Without them, rules score the candidates.
async function seedScores() {
  const fixture = readScoreFixture();
  if (!fixture) {
    console.log(
      "No captured scores found; scoring seeded candidates with rules.",
    );
  }
  for (const jd of truth) {
    const file = jd.file.split("/").pop()!;
    const requisition = await prisma.requisition.findFirst({
      where: { jdFileName: file },
      include: { scorecard: true, applications: true },
    });
    if (requisition?.scorecard?.status !== "CONFIRMED") continue;
    for (const app of requisition.applications) {
      const cv = await scorableCv(app.candidateId);
      if (!cv) continue;
      const row = await prisma.cvDocument.findUniqueOrThrow({
        where: { id: cv.id },
        select: { fileName: true },
      });
      const captured = fixture?.scores[jd.key]?.[`cvs/${row.fileName}`];
      await processScore(app.id, {
        ai: async (criteria) =>
          captured
            ? {
                verdicts: fixtureVerdicts(captured, criteria),
                run: {
                  model: captured.model,
                  outcome: captured.outcome as AiOutcome,
                  latencyMs: captured.latencyMs,
                  inputTokens: captured.inputTokens,
                  outputTokens: captured.outputTokens,
                  errorMessage: null,
                },
              }
            : {
                verdicts: null,
                run: {
                  model: "rules",
                  outcome: "NOT_CONFIGURED",
                  latencyMs: 0,
                  inputTokens: null,
                  outputTokens: null,
                  errorMessage: null,
                },
              },
      });
    }
  }
}

// A believable desk: Ananya has opened and screened the three best Kestrel
// candidates and turned down the two weakest.
async function seedDecisions() {
  const file = "Kestrel_Senior_Java_Developer_JD.docx";
  const requisition = await prisma.requisition.findFirst({
    where: { jdFileName: file },
    include: { scorecard: true, applications: { include: { scores: true } } },
  });
  const ananya = await prisma.user.findUnique({
    where: { email: "ananya.sharma@hireproof.test" },
  });
  if (!requisition?.scorecard || !ananya) return;
  if (requisition.applications.some((a) => a.stage !== "SOURCED")) return;

  const order = { STRONG: 0, POSSIBLE: 1, WEAK: 2 } as const;
  const scored = requisition.applications
    .flatMap((app) => {
      const score = app.scores.find(
        (s) => s.scorecardVersion === requisition.scorecard!.version,
      );
      return score ? [{ app, score }] : [];
    })
    .sort(
      (a, b) =>
        order[a.score.band] - order[b.score.band] ||
        b.score.total - a.score.total,
    );
  const band = ({ score }: (typeof scored)[number]) => ({
    band: score.band,
    total: score.total,
    scoreSource: score.source,
    scorecardVersion: score.scorecardVersion,
    stale: false,
  });
  const base = { actorId: ananya.id, entityType: "Application" };

  for (const item of scored.slice(0, 3)) {
    const cv = await scorableCv(item.app.candidateId);
    if (!cv) continue;
    await audit({
      actorId: ananya.id,
      action: "CV_VIEWED",
      entityType: "CvDocument",
      entityId: cv.id,
      meta: {
        candidateId: item.app.candidateId,
        requisitionId: requisition.id,
      },
    });
    await prisma.application.update({
      where: { id: item.app.id },
      data: {
        stage: "SCREENED",
        decidedById: ananya.id,
        decidedAt: new Date(),
      },
    });
    await audit({
      ...base,
      action: "APPLICATION_SCREENED",
      entityId: item.app.id,
      meta: { ...band(item), cvId: cv.id },
    });
  }
  const reasons = ["SKILLS_GAP", "EXPERIENCE"] as const;
  for (const [i, item] of scored.slice(-2).entries()) {
    await prisma.application.update({
      where: { id: item.app.id },
      data: {
        stage: "REJECTED",
        rejectReason: reasons[i],
        decidedById: ananya.id,
        decidedAt: new Date(),
      },
    });
    await audit({
      ...base,
      action: "APPLICATION_REJECTED",
      entityId: item.app.id,
      meta: { ...band(item), reason: reasons[i], fromStage: "SOURCED" },
    });
  }
}

async function main() {
  const password = process.env.SEED_DEMO_PASSWORD;
  if (!password || password.length < 8) {
    throw new Error(
      "Set SEED_DEMO_PASSWORD (at least 8 characters) in .env before seeding.",
    );
  }
  const passwordHash = await bcrypt.hash(password, 10);

  for (const { id, ...data } of CLIENTS) {
    await prisma.client.upsert({
      where: { id },
      update: data,
      create: { id, ...data },
    });
  }

  for (const user of DEMO_USERS) {
    const clientId = CLIENTS.find((c) => c.name === user.client)?.id ?? null;
    const data = { name: user.name, role: user.role, clientId, passwordHash };
    await prisma.user.upsert({
      where: { email: user.email },
      update: data,
      create: { email: user.email, ...data },
    });
  }

  await seedRequisitions();
  await seedCandidates();
  await seedScores();
  await seedDecisions();

  console.table(
    DEMO_USERS.map(({ email, role, client }) => ({
      email,
      role,
      client: client ?? "-",
    })),
  );
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
