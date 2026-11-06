import bcrypt from "bcryptjs";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DEMO_USERS, canonicalSkill } from "@hireproof/shared";
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
      // A confirmed scorecard has been through review: flags cleared, and at
      // least one must-have, taken from the ground truth when the rules ran.
      const wanted = new Set(
        jd.mustHaveSkills.map((s) => canonicalSkill(s) ?? s),
      );
      extraction.scorecard = {
        ...extraction.scorecard,
        criteria: extraction.scorecard.criteria.map((c) => ({
          ...c,
          kind:
            wanted.has(c.label) || c.kind === "MUST_HAVE"
              ? "MUST_HAVE"
              : c.kind,
          needsReview: false,
        })),
      };
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

// Per requisition, the sample CVs meant for it. The three CVs that fit no role
// ride along in the first Kestrel pool, like a mixed pile of real applications.
// The seed may read the evaluation labels; the app never does.
const poolFor = (key: string) =>
  cvTruth.filter(
    (c) =>
      c.intendedRequisition === key ||
      (key === "kestrel-senior-java" && c.intendedRequisition === null),
  );

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
