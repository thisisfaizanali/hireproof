import bcrypt from "bcryptjs";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  CONSENT_NOTICE_VERSION,
  DEMO_USERS,
  addDays,
  parseIst,
  weekStartOf,
  type AiOutcome,
} from "@hireproof/shared";
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
import { eraseCandidate } from "../src/erasure";
import { weekInsights } from "../src/insights";
import { interviewInvite } from "../src/messages";
import { scorecardHash } from "../src/scorecardHash";
import { processScore, scorableCv } from "../src/score/job";
import { readJd, truth } from "../scripts/jds";
import { prisma } from "../src/db";
import type { Industry, Prisma } from "../src/generated/prisma/client";

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

const CONSENT_SOURCE: Record<
  string,
  "JOB_PORTAL" | "AGENCY_DATABASE" | "REFERRAL"
> = {
  "kestrel-senior-java": "JOB_PORTAL",
  "sahyadri-kyc-analyst": "AGENCY_DATABASE",
};

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

    // The CVs came in two weeks ago, each batch from its own source.
    const arrived = ago(14, 9);
    const consentSource = CONSENT_SOURCE[jd.key] ?? "REFERRAL";
    const batch = await prisma.uploadBatch.create({
      data: {
        requisitionId: requisition.id,
        uploadedById: requisition.ownerId,
        expectedCount: pool.length,
        consentSource,
        consentAt: arrived,
        createdAt: arrived,
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
          createdAt: arrived,
          consent: {
            create: {
              basis: "APPLIED_OR_AGREED",
              source: consentSource,
              attestedById: requisition.ownerId,
              attestedAt: arrived,
              noticeVersion: CONSENT_NOTICE_VERSION,
            },
          },
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

const DAY = 86_400_000;
const ago = (days: number, hour = 10) => {
  const at = new Date(Date.now() - days * DAY);
  at.setUTCHours(hour, 15, 0, 0);
  return at;
};

// A weekday at least `days` ahead at a time in IST, as a Date.
function nextIst(days: number, time: string) {
  const wall = new Date(Date.now() + 330 * 60_000 + days * DAY);
  while (wall.getUTCDay() === 0 || wall.getUTCDay() === 6) {
    wall.setUTCDate(wall.getUTCDate() + 1);
  }
  return parseIst(`${wall.toISOString().slice(0, 10)}T${time}`)!;
}

// Events carry their own date so the trail reads like a week of work.
const event = (
  actorId: string,
  action: string,
  entityType: string,
  entityId: string,
  meta: Prisma.InputJsonValue,
  createdAt: Date,
) =>
  prisma.auditEvent.create({
    data: { actorId, action, entityType, entityId, meta, createdAt },
  });

async function ranked(requisitionId: string) {
  const requisition = await prisma.requisition.findUniqueOrThrow({
    where: { id: requisitionId },
    include: { scorecard: true, applications: { include: { scores: true } } },
  });
  const order = { STRONG: 0, POSSIBLE: 1, WEAK: 2 } as const;
  return requisition.applications
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
}

type Ranked = Awaited<ReturnType<typeof ranked>>[number];

const bandMeta = ({ score }: Ranked) => ({
  band: score.band,
  total: score.total,
  scoreSource: score.source,
  scorecardVersion: score.scorecardVersion,
  stale: false,
});

async function screen(item: Ranked, recruiterId: string, when: Date) {
  const cv = await scorableCv(item.app.candidateId);
  if (!cv) return;
  await event(
    recruiterId,
    "CV_VIEWED",
    "CvDocument",
    cv.id,
    {
      candidateId: item.app.candidateId,
      requisitionId: item.app.requisitionId,
    },
    when,
  );
  await prisma.application.update({
    where: { id: item.app.id },
    data: { stage: "SCREENED", decidedById: recruiterId, decidedAt: when },
  });
  await event(
    recruiterId,
    "APPLICATION_SCREENED",
    "Application",
    item.app.id,
    { ...bandMeta(item), cvId: cv.id },
    new Date(when.getTime() + 4 * 60_000),
  );
}

// The recruiter desk: the best candidates screened, the two weakest turned
// down. Kestrel's top five and Sahyadri's top three are then submitted.
async function seedDecisions() {
  const [kestrel, sahyadri] = await Promise.all(
    [
      "Kestrel_Senior_Java_Developer_JD.docx",
      "Sahyadri_Finserv_KYC_Analyst_JD.pdf",
    ].map((file) =>
      prisma.requisition.findFirst({
        where: { jdFileName: file },
        include: { owner: true },
      }),
    ),
  );
  if (!kestrel || !sahyadri) return;
  if (
    await prisma.application.count({
      where: { requisitionId: kestrel.id, stage: { not: "SOURCED" } },
    })
  ) {
    return;
  }

  const kestrelRanked = await ranked(kestrel.id);
  for (const [i, item] of kestrelRanked.slice(0, 5).entries()) {
    await screen(item, kestrel.ownerId, ago(8 - i, 9 + i));
  }
  const reasons = ["SKILLS_GAP", "EXPERIENCE"] as const;
  for (const [i, item] of kestrelRanked.slice(-2).entries()) {
    await prisma.application.update({
      where: { id: item.app.id },
      data: {
        stage: "REJECTED",
        rejectedBy: "RECRUITER",
        rejectReason: reasons[i],
        decidedById: kestrel.ownerId,
        decidedAt: ago(7, 15 + i),
      },
    });
    await event(
      kestrel.ownerId,
      "APPLICATION_REJECTED",
      "Application",
      item.app.id,
      { ...bandMeta(item), reason: reasons[i], fromStage: "SOURCED" },
      ago(7, 15 + i),
    );
  }

  const sahyadriRanked = await ranked(sahyadri.id);
  for (const [i, item] of sahyadriRanked.slice(0, 3).entries()) {
    await screen(item, sahyadri.ownerId, ago(10 - i, 11 + i));
  }
}

const first = (name: string) => name.split(/\s+/)[0];

// A recruiter's reason for putting someone forward, from what is on file.
function noteFor(
  kind: "java" | "kyc",
  c: {
    name: string;
    currentRole: string | null;
    totalExperienceYears: unknown;
    noticeDays: number | null;
    skills: string[];
  },
  i: number,
) {
  const years = c.totalExperienceYears ? Number(c.totalExperienceYears) : null;
  const role = c.currentRole ?? "their current role";
  const notice =
    c.noticeDays === null
      ? "not stated on the CV"
      : c.noticeDays === 0
        ? "immediate"
        : `${c.noticeDays} days`;
  const stack = c.skills.slice(0, 3).join(", ") || "the core stack";
  const java = [
    `${years ?? "Several"} years as ${role}. ${stack} are in recent roles, not only on the skills list. Notice is ${notice}.`,
    `Has run production services on ${stack} for ${years ?? "several"} years and moved a monolith to services in the last role. Notice is ${notice}.`,
    `${first(c.name)} is the closest match on ${stack}. Currently ${role}. Notice is ${notice}.`,
    `Solid on ${stack} with ${years ?? "several"} years behind it. Spoke to ${first(c.name)} on Tuesday and expectations are in range. Notice is ${notice}.`,
    `Backup option. ${years ?? "Several"} years, ${stack}, currently ${role}. Notice is ${notice}.`,
  ];
  const kyc = [
    `${years ?? "Several"} years in KYC operations, currently ${role}. Has done periodic reviews and screening on ${stack}. Notice is ${notice}.`,
    `Hands-on with ${stack} and a graduate. ${first(c.name)} reads files quickly and the references are clean. Notice is ${notice}.`,
    `${years ?? "Several"} years in onboarding and due diligence, currently ${role}. Notice is ${notice}.`,
  ];
  return (kind === "java" ? java : kyc)[i % (kind === "java" ? 5 : 3)];
}

async function submit(
  item: Ranked,
  kind: "java" | "kyc",
  i: number,
  recruiterId: string,
  when: Date,
) {
  const candidate = await prisma.candidate.findUniqueOrThrow({
    where: { id: item.app.candidateId },
  });
  const note = noteFor(kind, candidate, i);
  await prisma.application.update({
    where: { id: item.app.id },
    data: {
      stage: "SUBMITTED",
      submittedAt: when,
      submittedById: recruiterId,
      submissionNote: note,
    },
  });
  await event(
    recruiterId,
    "APPLICATION_SUBMITTED",
    "Application",
    item.app.id,
    { ...bandMeta(item), noteLength: note.length },
    when,
  );
  return candidate;
}

const clientView = (clientUserId: string, item: Ranked, when: Date) =>
  event(
    clientUserId,
    "CLIENT_CANDIDATE_VIEWED",
    "Application",
    item.app.id,
    { requisitionId: item.app.requisitionId },
    when,
  );

async function shortlist(clientUserId: string, item: Ranked, when: Date) {
  await clientView(clientUserId, item, new Date(when.getTime() - 9 * 60_000));
  await prisma.application.update({
    where: { id: item.app.id },
    data: { stage: "CLIENT_SHORTLISTED" },
  });
  await event(
    clientUserId,
    "CLIENT_SHORTLISTED",
    "Application",
    item.app.id,
    { requisitionId: item.app.requisitionId, ...bandMeta(item) },
    when,
  );
}

async function propose(
  clientUserId: string,
  item: Ranked,
  slots: {
    startsAt: Date;
    durationMinutes: number;
    mode: "VIDEO" | "IN_PERSON";
    note?: string;
  }[],
  when: Date,
) {
  const rows = [];
  for (const s of slots) {
    rows.push(
      await prisma.interviewSlot.create({
        data: {
          applicationId: item.app.id,
          note: s.note ?? null,
          proposedById: clientUserId,
          createdAt: when,
          ...s,
        },
      }),
    );
  }
  await event(
    clientUserId,
    "SLOT_PROPOSED",
    "Application",
    item.app.id,
    { requisitionId: item.app.requisitionId, slots: slots.length },
    when,
  );
  return rows;
}

// The recruiter books one time: that slot confirmed, the others declined, the
// stage moved and a message to the candidate recorded as mocked.
async function confirm(
  recruiter: { id: string; name: string },
  item: Ranked,
  slots: Awaited<ReturnType<typeof propose>>,
  pick: number,
  candidateName: string,
  clientName: string,
  title: string,
  when: Date,
) {
  for (const [i, s] of slots.entries()) {
    await prisma.interviewSlot.update({
      where: { id: s.id },
      data: { status: i === pick ? "CONFIRMED" : "DECLINED" },
    });
  }
  await prisma.application.update({
    where: { id: item.app.id },
    data: { stage: "INTERVIEW" },
  });
  const chosen = slots[pick];
  const mail = interviewInvite({
    candidateName,
    clientName,
    title,
    startsAt: chosen.startsAt,
    durationMinutes: chosen.durationMinutes,
    mode: chosen.mode,
    note: chosen.note,
    recruiterName: recruiter.name,
  });
  const message = await prisma.outboundMessage.create({
    data: {
      applicationId: item.app.id,
      recipient: "CANDIDATE",
      createdById: recruiter.id,
      createdAt: when,
      ...mail,
    },
  });
  const t = (min: number) => new Date(when.getTime() + min * 60_000);
  await event(
    recruiter.id,
    "SLOT_CONFIRMED",
    "Application",
    item.app.id,
    { slotId: chosen.id },
    when,
  );
  await event(
    recruiter.id,
    "STAGE_CHANGED",
    "Application",
    item.app.id,
    { from: "CLIENT_SHORTLISTED", to: "INTERVIEW" },
    t(1),
  );
  await event(
    recruiter.id,
    "MESSAGE_RECORDED",
    "Application",
    item.app.id,
    { messageId: message.id, recipient: "CANDIDATE", status: "MOCKED" },
    t(2),
  );
}

// Two clients, a week of activity: what each hiring manager has answered, what
// is waiting on them and what is waiting on the recruiter.
async function seedClientActivity() {
  const get = (email: string) =>
    prisma.user.findUniqueOrThrow({ where: { email } });
  const [priya, arjun] = await Promise.all([
    get("priya.nair@kestrelinfotech.test"),
    get("arjun.kulkarni@sahyadrifinserv.test"),
  ]);
  const kestrel = await prisma.requisition.findFirst({
    where: { jdFileName: "Kestrel_Senior_Java_Developer_JD.docx" },
    include: { owner: true, client: true },
  });
  const sahyadri = await prisma.requisition.findFirst({
    where: { jdFileName: "Sahyadri_Finserv_KYC_Analyst_JD.pdf" },
    include: { owner: true, client: true },
  });
  if (!kestrel || !sahyadri) return;
  if (
    await prisma.application.count({
      where: { requisitionId: kestrel.id, submittedAt: { not: null } },
    })
  ) {
    return;
  }

  const k = (await ranked(kestrel.id)).filter(
    (r) => r.app.stage === "SCREENED",
  );
  const s = (await ranked(sahyadri.id)).filter(
    (r) => r.app.stage === "SCREENED",
  );
  const kOwner = kestrel.owner;
  const sOwner = sahyadri.owner;

  // Kestrel: a shortlist, a rejection, a booking waiting on the recruiter and
  // two candidates waiting on the hiring manager.
  const whenK = [ago(6, 8), ago(6, 9), ago(4, 10), ago(2, 9), ago(1, 11)];
  for (const [i, item] of k.slice(0, 5).entries()) {
    await submit(item, "java", i, kOwner.id, whenK[i]);
  }
  await shortlist(priya.id, k[0], ago(5, 9));
  await clientView(priya.id, k[1], ago(5, 10));
  await prisma.application.update({
    where: { id: k[1].app.id },
    data: {
      stage: "REJECTED",
      rejectedBy: "CLIENT",
      clientRejectReason: "NOTICE_PERIOD",
    },
  });
  await event(
    priya.id,
    "CLIENT_REJECTED",
    "Application",
    k[1].app.id,
    { requisitionId: kestrel.id, reason: "NOTICE_PERIOD", ...bandMeta(k[1]) },
    ago(5, 10),
  );
  await shortlist(priya.id, k[2], ago(2, 12));
  await propose(
    priya.id,
    k[2],
    [
      {
        startsAt: nextIst(2, "10:30"),
        durationMinutes: 45,
        mode: "VIDEO",
        note: "First round with the engineering lead",
      },
      { startsAt: nextIst(3, "15:00"), durationMinutes: 45, mode: "VIDEO" },
    ],
    ago(2, 12),
  );
  await clientView(priya.id, k[3], ago(1, 8));

  // Sahyadri: one candidate in interview, one with an offer, one to review.
  const whenS = [ago(9, 8), ago(9, 9), ago(1, 10)];
  const sCandidates = [];
  for (const [i, item] of s.slice(0, 3).entries()) {
    sCandidates.push(await submit(item, "kyc", i, sOwner.id, whenS[i]));
  }
  const sTitle = sahyadri.title;
  const sClient = sahyadri.client.name;

  await shortlist(arjun.id, s[0], ago(8, 10));
  const interviewSlots = await propose(
    arjun.id,
    s[0],
    [
      {
        startsAt: nextIst(1, "11:00"),
        durationMinutes: 45,
        mode: "IN_PERSON",
        note: "Meet at the Pune office, ask for Arjun at reception",
      },
      { startsAt: nextIst(2, "16:00"), durationMinutes: 45, mode: "IN_PERSON" },
      { startsAt: nextIst(3, "10:00"), durationMinutes: 30, mode: "VIDEO" },
    ],
    ago(8, 10),
  );
  await confirm(
    sOwner,
    s[0],
    interviewSlots,
    0,
    sCandidates[0].name,
    sClient,
    sTitle,
    ago(7, 9),
  );

  await shortlist(arjun.id, s[1], ago(8, 11));
  const done = await propose(
    arjun.id,
    s[1],
    [
      { startsAt: ago(3, 5), durationMinutes: 45, mode: "VIDEO" },
      { startsAt: ago(2, 5), durationMinutes: 45, mode: "VIDEO" },
    ],
    ago(8, 11),
  );
  await confirm(
    sOwner,
    s[1],
    done,
    0,
    sCandidates[1].name,
    sClient,
    sTitle,
    ago(7, 10),
  );
  await prisma.application.update({
    where: { id: s[1].app.id },
    data: { stage: "OFFERED" },
  });
  await event(
    sOwner.id,
    "STAGE_CHANGED",
    "Application",
    s[1].app.id,
    { from: "INTERVIEW", to: "OFFERED" },
    ago(1, 9),
  );
  await clientView(arjun.id, s[2], ago(0, 7));
}

const rulesOnly = {
  ai: async () => ({
    verdicts: null,
    run: {
      model: "rules",
      outcome: "NOT_CONFIGURED" as const,
      latencyMs: 0,
      inputTokens: null,
      outputTokens: null,
      errorMessage: null,
    },
  }),
};

async function reject(
  item: Ranked,
  recruiterId: string,
  reason: "SKILLS_GAP" | "EXPERIENCE" | "NOTICE_PERIOD" | "CTC" | "OTHER",
  when: Date,
) {
  await prisma.application.update({
    where: { id: item.app.id },
    data: {
      stage: "REJECTED",
      rejectedBy: "RECRUITER",
      rejectReason: reason,
      decidedById: recruiterId,
      decidedAt: when,
    },
  });
  await event(
    recruiterId,
    "APPLICATION_REJECTED",
    "Application",
    item.app.id,
    { ...bandMeta(item), reason, fromStage: "SOURCED" },
    when,
  );
}

// A decision on a candidate whose requisition has no scorecard yet.
async function screenUnscored(
  applicationId: string,
  recruiterId: string,
  when: Date,
) {
  const app = await prisma.application.findUniqueOrThrow({
    where: { id: applicationId },
  });
  const cv = await scorableCv(app.candidateId);
  if (!cv) return;
  await event(
    recruiterId,
    "CV_VIEWED",
    "CvDocument",
    cv.id,
    { candidateId: app.candidateId, requisitionId: app.requisitionId },
    new Date(when.getTime() - 5 * 60_000),
  );
  await prisma.application.update({
    where: { id: app.id },
    data: { stage: "SCREENED", decidedById: recruiterId, decidedAt: when },
  });
  await event(
    recruiterId,
    "APPLICATION_SCREENED",
    "Application",
    app.id,
    { band: null, cvId: cv.id },
    when,
  );
}

const VERDICTS = [
  "BOTH_REASONABLE",
  "AI_RIGHT",
  "AI_RIGHT",
  "RECRUITER_RIGHT",
  "AI_RIGHT",
  "BOTH_REASONABLE",
  "AI_RIGHT",
  "RECRUITER_RIGHT",
  "AI_RIGHT",
  "AI_RIGHT",
] as const;
const NOTES = [
  "Notice period decided it. Fair call.",
  null,
  null,
  "The recruiter spoke to the candidate. The CV undersells the Kafka work.",
  null,
  "The score leans on the skills list. Worth checking the quotes.",
] as const;

// Two weeks of work for the delivery head to read: decisions on both sides of
// the AI, reviews of last week's sample and part of this week's, a mix of AI
// outcomes, one erasure and two candidates past their retention date.
async function seedInsightHistory() {
  if ((await prisma.sampleReview.count()) > 0) return;
  const get = (email: string) =>
    prisma.user.findUniqueOrThrow({ where: { email } });
  const [head, priya, arjun, ananya, rohan] = await Promise.all([
    get("vikram.rao@hireproof.test"),
    get("priya.nair@kestrelinfotech.test"),
    get("arjun.kulkarni@sahyadrifinserv.test"),
    get("ananya.sharma@hireproof.test"),
    get("rohan.mehta@hireproof.test"),
  ]);
  const byFile = (file: string) =>
    prisma.requisition.findFirst({
      where: { jdFileName: file },
      include: { owner: true },
    });
  const marigoldFile = truth
    .find((j) => j.key === "marigold-store-ops")!
    .file.split("/")
    .pop()!;
  const [kestrel, sahyadri, marigold] = await Promise.all([
    byFile("Kestrel_Senior_Java_Developer_JD.docx"),
    byFile("Sahyadri_Finserv_KYC_Analyst_JD.pdf"),
    byFile(marigoldFile),
  ]);
  if (!kestrel || !sahyadri || !marigold) return;

  const thisWeek = weekStartOf(new Date());
  const lastWeek = addDays(thisWeek, -7);
  // Never later than a little before now, so a Monday run stays in the past.
  const at = (week: string, day: number, time: string, jitter = 0) =>
    new Date(
      Math.min(
        parseIst(`${addDays(week, day)}T${time}`)!.getTime(),
        Date.now() - (30 + jitter) * 60_000,
      ),
    );

  // Three Weak matches are scored again with rules, as happens when the model
  // is down.
  const weakSourced = (await ranked(kestrel.id)).filter(
    (r) => r.app.stage === "SOURCED" && r.score.band === "WEAK",
  );
  for (const item of weakSourced.slice(-3)) {
    await processScore(item.app.id, rulesOnly, true);
  }

  const pool = async (requisitionId: string) => {
    const rows = (await ranked(requisitionId)).filter(
      (r) => r.app.stage === "SOURCED",
    );
    const take = (band: "STRONG" | "POSSIBLE" | "WEAK") =>
      rows.filter((r) => r.score.band === band);
    return {
      strong: take("STRONG"),
      possible: take("POSSIBLE"),
      weak: take("WEAK"),
    };
  };
  const k = await pool(kestrel.id);
  const s = await pool(sahyadri.id);

  // When the CVs arrived. Kestrel and Sahyadri came in last Monday; five more
  // Kestrel CVs arrived by referral on Monday this week, in a batch of their
  // own with its own consent. Marigold's came a week earlier.
  const first = at(lastWeek, 0, "09:00");
  const second = at(thisWeek, 0, "09:00", 60);
  const tranche = [k.strong[3], k.possible[3], k.weak[4], k.weak[5], k.weak[6]];
  const trancheIds = tranche.map((t) => t.app.id);
  const trancheCandidates = tranche.map((t) => t.app.candidateId);
  const batch = await prisma.uploadBatch.create({
    data: {
      requisitionId: kestrel.id,
      uploadedById: ananya.id,
      expectedCount: tranche.length,
      consentSource: "REFERRAL",
      consentAt: second,
      createdAt: second,
    },
  });
  await prisma.cvDocument.updateMany({
    where: {
      candidateId: { in: trancheCandidates },
      requisitionId: kestrel.id,
    },
    data: { batchId: batch.id, createdAt: second },
  });
  await prisma.consentRecord.updateMany({
    where: { candidateId: { in: trancheCandidates } },
    data: { source: "REFERRAL", attestedAt: second },
  });
  await prisma.application.updateMany({
    where: { id: { in: trancheIds } },
    data: { createdAt: second },
  });
  for (const requisition of [kestrel, sahyadri]) {
    await prisma.application.updateMany({
      where: { requisitionId: requisition.id, id: { notIn: trancheIds } },
      data: { createdAt: first },
    });
    await prisma.cvDocument.updateMany({
      where: {
        requisitionId: requisition.id,
        candidateId: { notIn: trancheCandidates },
      },
      data: { createdAt: first },
    });
    await prisma.consentRecord.updateMany({
      where: {
        cv: { requisitionId: requisition.id },
        candidateId: { notIn: trancheCandidates },
      },
      data: { attestedAt: first },
    });
    await prisma.uploadBatch.updateMany({
      where: { requisitionId: requisition.id, id: { not: batch.id } },
      data: { createdAt: first, consentAt: first },
    });
  }
  const earlier = at(addDays(lastWeek, -7), 0, "09:00");
  await prisma.application.updateMany({
    where: { requisitionId: marigold.id },
    data: { createdAt: earlier },
  });
  await prisma.cvDocument.updateMany({
    where: { requisitionId: marigold.id },
    data: { createdAt: earlier },
  });
  await prisma.consentRecord.updateMany({
    where: { cv: { requisitionId: marigold.id } },
    data: { attestedAt: earlier },
  });
  await prisma.uploadBatch.updateMany({
    where: { requisitionId: marigold.id },
    data: { createdAt: earlier, consentAt: earlier },
  });

  // Last week.
  const L = (day: number, time: string, jitter = 0) =>
    at(lastWeek, day, time, jitter);
  await screen(k.strong[0], ananya.id, L(0, "10:20"));
  await screen(k.strong[1], ananya.id, L(0, "11:05"));
  await reject(k.strong[2], ananya.id, "NOTICE_PERIOD", L(1, "12:10"));
  await screen(k.possible[0], ananya.id, L(1, "15:30"));
  await screen(k.possible[1], ananya.id, L(2, "10:45"));
  await reject(k.possible[2], ananya.id, "SKILLS_GAP", L(2, "16:15"));
  await reject(k.weak[0], ananya.id, "SKILLS_GAP", L(3, "10:05"));
  await reject(k.weak[1], ananya.id, "EXPERIENCE", L(3, "10:40"));
  await reject(k.weak[2], ananya.id, "SKILLS_GAP", L(3, "11:20"));
  await screen(k.weak[3], ananya.id, L(3, "14:00"));
  await submit(k.weak[3], "java", 2, ananya.id, L(4, "11:30"));
  await screen(s.strong[0], rohan.id, L(0, "14:10"));
  await screen(s.strong[1], rohan.id, L(1, "09:40"));
  await reject(s.strong[2], rohan.id, "EXPERIENCE", L(2, "13:25"));
  await screen(s.possible[0], rohan.id, L(2, "15:05"));
  await screen(s.possible[1], rohan.id, L(4, "10:15"));
  const marigoldApps = await prisma.application.findMany({
    where: { requisitionId: marigold.id, stage: "SOURCED" },
    orderBy: { id: "asc" },
  });
  await screenUnscored(marigoldApps[0].id, ananya.id, L(1, "17:00"));
  await screenUnscored(marigoldApps[1].id, ananya.id, L(2, "17:20"));

  // This week.
  const T = (day: number, time: string, jitter = 0) =>
    at(thisWeek, day, time, jitter);
  await shortlist(priya.id, k.weak[3], T(0, "12:30", 3));
  await screen(k.strong[3], ananya.id, T(0, "10:10", 6));
  await screen(k.possible[3], ananya.id, T(0, "11:40", 9));
  await reject(k.weak[4], ananya.id, "SKILLS_GAP", T(1, "10:30", 12));
  await reject(k.weak[5], ananya.id, "EXPERIENCE", T(1, "11:10", 15));
  await screen(k.weak[6], ananya.id, T(1, "15:45", 18));
  await reject(s.strong[3], rohan.id, "OTHER", T(0, "15:20", 21));
  await screen(s.possible[2], rohan.id, T(1, "09:50", 24));
  await screen(s.possible[3], rohan.id, T(1, "12:05", 27));

  // The sample: last week's reviewed in full, this week's in part.
  const review = async (
    week: string,
    reviewedAt: Date,
    count: number | null,
  ) => {
    const { sample } = await weekInsights(week, thisWeek);
    const items = count === null ? sample.items : sample.items.slice(0, count);
    for (const [i, item] of items.entries()) {
      await prisma.sampleReview.create({
        data: {
          weekStart: new Date(`${week}T00:00:00Z`),
          applicationId: item.applicationId,
          verdict: VERDICTS[i % VERDICTS.length],
          note: NOTES[i % NOTES.length],
          reviewedById: head.id,
          reviewedAt: new Date(reviewedAt.getTime() + i * 4 * 60_000),
          band: item.band,
          decision: item.action,
          requisitionNumber: item.requisitionNumber,
        },
      });
    }
  };
  await review(lastWeek, at(thisWeek, 0, "11:00"), null);
  const open = (await weekInsights(thisWeek, thisWeek)).sample.items.length;
  await review(
    thisWeek,
    at(thisWeek, 1, "09:20", 30),
    Math.max(1, Math.min(4, open - 1)),
  );

  // AI outcomes. Kestrel was scored last week; Sahyadri's trouble and the
  // rescoring with rules fall in this one.
  const lastTuesday = at(lastWeek, 1, "09:30");
  await prisma.candidateScore.updateMany({
    where: { application: { requisitionId: kestrel.id }, source: "AI" },
    data: { createdAt: lastTuesday },
  });
  await prisma.aiRun.updateMany({
    where: { requisitionId: kestrel.id, kind: "CV_SCORE", outcome: "OK" },
    data: { createdAt: lastTuesday },
  });
  await prisma.aiRun.updateMany({
    where: { kind: "CV_PARSE" },
    data: { createdAt: first },
  });
  const model = "openai/gpt-oss-120b";
  await prisma.aiRun.createMany({
    data: [
      {
        kind: "CV_SCORE",
        requisitionId: kestrel.id,
        model,
        outcome: "RETRIED_OK",
        latencyMs: 9400,
        inputTokens: 2310,
        outputTokens: 640,
        createdAt: at(lastWeek, 1, "09:41"),
      },
      {
        kind: "CV_SCORE",
        requisitionId: kestrel.id,
        model,
        outcome: "INVALID_OUTPUT",
        latencyMs: 6100,
        inputTokens: 2290,
        outputTokens: 120,
        errorMessage: "The reply was not valid JSON",
        createdAt: at(lastWeek, 1, "09:52"),
      },
      {
        kind: "CV_SCORE",
        requisitionId: sahyadri.id,
        model,
        outcome: "PROVIDER_ERROR",
        latencyMs: 800,
        errorMessage: "The provider returned 429 (rate limit)",
        createdAt: at(thisWeek, 1, "10:02", 33),
      },
      {
        kind: "CV_SCORE",
        requisitionId: sahyadri.id,
        model,
        outcome: "PROVIDER_ERROR",
        latencyMs: 790,
        errorMessage: "The provider returned 429 (rate limit)",
        createdAt: at(thisWeek, 1, "10:03", 34),
      },
    ],
  });

  // One erasure on request, and two candidates left untouched for over a year.
  const rest = marigoldApps.slice(2);
  const erased = await eraseCandidate({
    candidateId: rest[rest.length - 1].candidateId,
    reason: "CANDIDATE_REQUEST",
    actorId: head.id,
  });
  if (erased) {
    const when = ago(3, 11);
    await prisma.deletionRecord.updateMany({ data: { deletedAt: when } });
    await prisma.auditEvent.updateMany({
      where: { action: "CANDIDATE_DELETED" },
      data: { createdAt: when },
    });
  }
  const monthsAgo = (n: number) => {
    const d = new Date();
    d.setUTCMonth(d.getUTCMonth() - n);
    return d;
  };
  for (const [i, app] of rest.slice(0, 2).entries()) {
    const when = monthsAgo(14 + i * 3);
    await prisma.candidate.update({
      where: { id: app.candidateId },
      data: { lastActivityAt: when },
    });
    await prisma.cvDocument.updateMany({
      where: { candidateId: app.candidateId },
      data: { createdAt: when },
    });
    await prisma.consentRecord.updateMany({
      where: { candidateId: app.candidateId },
      data: { attestedAt: when },
    });
  }

  // Sign-ins across both weeks, and an address on everything that has none.
  const ips: [string, string][] = [
    [ananya.id, "203.0.113.24"],
    [rohan.id, "203.0.113.31"],
    [head.id, "198.51.100.12"],
    [priya.id, "192.0.2.77"],
  ];
  for (const [week, day] of [
    [lastWeek, 0],
    [lastWeek, 2],
    [lastWeek, 4],
    [thisWeek, 0],
    [thisWeek, 1],
  ] as const) {
    for (const [i, [id, ip]] of ips.entries()) {
      await prisma.auditEvent.create({
        data: {
          actorId: id,
          action: "LOGIN_SUCCEEDED",
          entityType: "User",
          entityId: id,
          ip,
          createdAt: at(
            week,
            day,
            `${String(8 + i).padStart(2, "0")}:${10 + i * 7}`,
            i,
          ),
        },
      });
    }
  }
  for (const [id, ip] of [
    ...ips,
    [arjun.id, "192.0.2.91"] as [string, string],
  ]) {
    await prisma.auditEvent.updateMany({
      where: { actorId: id, ip: null },
      data: { ip },
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
  await seedClientActivity();
  await seedInsightHistory();

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
