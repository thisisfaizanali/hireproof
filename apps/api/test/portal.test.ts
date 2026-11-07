import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/db";
import { resetDb } from "./helpers";
import { cvs, textCorpus } from "./cvCorpus";
import {
  EMAIL,
  PHONE,
  candidateAt,
  createClient,
  createStaff,
  get,
  openRequisition,
  post,
} from "./pipelineHelpers";

let recruiter: Awaited<ReturnType<typeof createStaff>>;
let head: Awaited<ReturnType<typeof createStaff>>;
let priya: Awaited<ReturnType<typeof createClient>>;
let arjun: Awaited<ReturnType<typeof createClient>>;
let kestrelReq: string;
let sahyadriReq: string;

beforeEach(async () => {
  await resetDb();
  recruiter = await createStaff("RECRUITER", "ananya@example.test");
  head = await createStaff("DELIVERY_HEAD", "vikram@example.test");
  priya = await createClient("Kestrel", "priya@example.test");
  arjun = await createClient("Sahyadri", "arjun@example.test");
  kestrelReq = (await openRequisition(priya.client.id, recruiter.user.id)).id;
  sahyadriReq = (
    await openRequisition(arjun.client.id, recruiter.user.id, "KYC Analyst")
  ).id;
});

const idsOf = (body: { items: { applicationId: string }[] }) =>
  body.items.map((i) => i.applicationId);

// Ids are random text that could, rarely, hold ten digits in a row.
const scan = (body: unknown) =>
  JSON.stringify(body, (key, value) =>
    /^(id|applicationId)$/.test(key) ? undefined : value,
  );
const ANY_EMAIL =
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/;
const ANY_PHONE =
  /(?<![\d.])(?:(?:\+|00)?91[\s.-]*)?0?[6-9]\d{4}[\s.-]?\d{5}(?!\d)/;

describe("the client's lists", () => {
  it("show submitted and later applications, awaiting review first", async () => {
    const old = new Date("2026-11-01T10:00:00Z");
    const newer = new Date("2026-11-03T10:00:00Z");
    const a = await candidateAt(
      kestrelReq,
      recruiter.user.id,
      "CLIENT_SHORTLISTED",
      "Shortlisted One",
      { submittedAt: newer },
    );
    const b = await candidateAt(
      kestrelReq,
      recruiter.user.id,
      "SUBMITTED",
      "Waiting Old",
      { submittedAt: old },
    );
    const c = await candidateAt(
      kestrelReq,
      recruiter.user.id,
      "SUBMITTED",
      "Waiting New",
      { submittedAt: newer },
    );
    await candidateAt(kestrelReq, recruiter.user.id, "SOURCED", "Not Yet");
    await candidateAt(
      kestrelReq,
      recruiter.user.id,
      "SCREENED",
      "Screened Only",
    );
    await candidateAt(
      kestrelReq,
      recruiter.user.id,
      "WITHDRAWN",
      "Pulled Back",
    );

    const res = await get(
      priya.cookie,
      `/api/portal/requisitions/${kestrelReq}/candidates`,
    );
    expect(res.status).toBe(200);
    expect(idsOf(res.body)).toEqual([
      c.application.id,
      b.application.id,
      a.application.id,
    ]);
    expect(res.body.counts).toEqual({
      submitted: 3,
      awaitingReview: 2,
      shortlisted: 1,
      interviews: 0,
    });
  });

  it("count each requisition on the home list", async () => {
    await candidateAt(kestrelReq, recruiter.user.id, "SUBMITTED");
    await candidateAt(
      kestrelReq,
      recruiter.user.id,
      "INTERVIEW",
      "Two Interview",
    );
    await candidateAt(
      kestrelReq,
      recruiter.user.id,
      "SCREENED",
      "Three Screened",
    );
    await candidateAt(
      sahyadriReq,
      recruiter.user.id,
      "SUBMITTED",
      "Other Client",
    );
    const res = await get(priya.cookie, "/api/portal/requisitions");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({
      id: kestrelReq,
      counts: {
        submitted: 2,
        awaitingReview: 1,
        shortlisted: 0,
        interviews: 1,
      },
    });
  });

  it("never list a draft requisition", async () => {
    const draft = await prisma.requisition.create({
      data: {
        clientId: priya.client.id,
        ownerId: recruiter.user.id,
        title: "Draft role",
        jdText: "A job description.",
      },
    });
    const res = await get(priya.cookie, "/api/portal/requisitions");
    expect(res.body.map((r: { id: string }) => r.id)).toEqual([kestrelReq]);
    expect(
      (
        await get(
          priya.cookie,
          `/api/portal/requisitions/${draft.id}/candidates`,
        )
      ).status,
    ).toBe(404);
  });
});

describe("tenant isolation", () => {
  it("returns 404, not 403, for another client's requisition and application", async () => {
    const theirs = await candidateAt(
      sahyadriReq,
      recruiter.user.id,
      "SUBMITTED",
      "Other Client",
    );
    const mine = await candidateAt(kestrelReq, recruiter.user.id, "SUBMITTED");

    const req = await get(
      priya.cookie,
      `/api/portal/requisitions/${sahyadriReq}/candidates`,
    );
    expect(req.status).toBe(404);
    expect(
      (
        await get(
          priya.cookie,
          `/api/portal/applications/${theirs.application.id}`,
        )
      ).status,
    ).toBe(404);
    // The same id does not leak either way: Arjun cannot open Priya's.
    expect(
      (
        await get(
          arjun.cookie,
          `/api/portal/applications/${mine.application.id}`,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await get(
          arjun.cookie,
          `/api/portal/requisitions/${kestrelReq}/candidates`,
        )
      ).status,
    ).toBe(404);

    const home = await get(priya.cookie, "/api/portal/requisitions");
    expect(JSON.stringify(home.body)).not.toContain("Other Client");
    expect(JSON.stringify(home.body)).not.toContain("KYC Analyst");
  });

  it("hides applications that are not submitted yet, even by id", async () => {
    for (const stage of ["SOURCED", "SCREENED", "WITHDRAWN"] as const) {
      const hidden = await candidateAt(
        kestrelReq,
        recruiter.user.id,
        stage,
        `Hidden ${stage}`,
      );
      expect(
        (
          await get(
            priya.cookie,
            `/api/portal/applications/${hidden.application.id}`,
          )
        ).status,
      ).toBe(404);
    }
  });
});

describe("access by role", () => {
  it("lets only a hiring manager use the portal", async () => {
    const { application } = await candidateAt(
      kestrelReq,
      recruiter.user.id,
      "SUBMITTED",
    );
    const paths = [
      "/api/portal/requisitions",
      `/api/portal/requisitions/${kestrelReq}/candidates`,
      `/api/portal/applications/${application.id}`,
    ];
    for (const path of paths) {
      expect((await get(recruiter.cookie, path)).status).toBe(403);
      expect((await get(head.cookie, path)).status).toBe(403);
      expect((await get(priya.cookie, path)).status).toBe(200);
    }
    const anonymous = await get("", paths[0]);
    expect(anonymous.status).toBe(401);
  });

  it("keeps hiring managers out of the internal routes", async () => {
    const { application, cv, candidate } = await candidateAt(
      kestrelReq,
      recruiter.user.id,
      "SUBMITTED",
    );
    const internal = [
      `/api/requisitions/${kestrelReq}/candidates`,
      `/api/candidates/${candidate.id}`,
      `/api/applications/${application.id}/score`,
      `/api/cvs/${cv.id}/file`,
      `/api/cvs/${cv.id}/text`,
      "/api/requisitions",
    ];
    for (const path of internal) {
      expect((await get(priya.cookie, path)).status, path).toBe(403);
    }
    for (const path of [
      `/api/applications/${application.id}/submit`,
      `/api/applications/${application.id}/withdraw`,
      `/api/applications/${application.id}/move`,
      `/api/applications/${application.id}/screen`,
    ]) {
      expect(
        (await post(priya.cookie, path, { note: "x", to: "OFFERED" })).status,
        path,
      ).toBe(403);
    }
  });
});

describe("what the client sees of a candidate", () => {
  it("is the profile, the note, the verdicts with verified quotes and the flags", async () => {
    const { application } = await candidateAt(
      kestrelReq,
      recruiter.user.id,
      "SUBMITTED",
    );
    const res = await get(
      priya.cookie,
      `/api/portal/applications/${application.id}`,
    );
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      name: "Riya Sen",
      currentRole: "Backend Engineer",
      totalExperienceYears: 6.5,
      noticeText: "30 days",
      noticeDays: 30,
      location: "Noida",
      skills: ["Java", "Spring Boot"],
      band: "STRONG",
      mustHavesMet: 1,
      mustHavesTotal: 1,
      stage: "SUBMITTED",
    });
    expect(res.body.note).toMatch(/Spring Boot services/);
    // Only the constraint sentences, never the internal ones.
    expect(res.body.flags).toEqual(["Notice 90 days, role allows 60."]);
    expect(res.body.criteria).toEqual([
      {
        label: "Java",
        kind: "MUST_HAVE",
        verdict: "MET",
        // The unverified quote is dropped, and the email in the first is masked.
        quotes: [
          "Riya Sen built REST APIs in Spring Boot, reach me on [email]",
        ],
      },
      {
        label: "Kafka",
        kind: "NICE_TO_HAVE",
        verdict: "NOT_FOUND",
        quotes: [],
      },
    ]);
    expect(res.body.cvText).toContain("RIYA SEN");
    expect(res.body.cvText).toContain("Riya Sen built REST APIs");
    expect(res.body.cvText).not.toMatch(/Date of Birth|Marital Status/);
  });

  it("opens only for the owning client and is audited", async () => {
    const { application } = await candidateAt(
      kestrelReq,
      recruiter.user.id,
      "SUBMITTED",
    );
    await get(priya.cookie, `/api/portal/applications/${application.id}`);
    const event = await prisma.auditEvent.findFirstOrThrow({
      where: { action: "CLIENT_CANDIDATE_VIEWED", entityId: application.id },
    });
    expect(event.actorId).toBe(priya.user.id);
    await get(arjun.cookie, `/api/portal/applications/${application.id}`);
    expect(
      await prisma.auditEvent.count({
        where: { action: "CLIENT_CANDIDATE_VIEWED" },
      }),
    ).toBe(1);
  });

  it("never carries an email, a phone, the total or the score source", async () => {
    const { application } = await candidateAt(
      kestrelReq,
      recruiter.user.id,
      "SUBMITTED",
    );
    const detail = await get(
      priya.cookie,
      `/api/portal/applications/${application.id}`,
    );
    const list = await get(
      priya.cookie,
      `/api/portal/requisitions/${kestrelReq}/candidates`,
    );
    for (const body of [detail.body, list.body]) {
      const text = scan(body);
      expect(text).not.toContain(EMAIL);
      expect(text).not.toContain(PHONE);
      expect(text).not.toMatch(ANY_EMAIL);
      expect(text).not.toMatch(ANY_PHONE);
      expect(text).not.toMatch(/"(total|source|reviewReasons|email|phone)"/);
    }
  });
});

describe("the leak test over the corpus", () => {
  it("keeps every corpus candidate's contact and personal fields out of the response", async () => {
    const { client, cookie } = await createClient(
      "Corpus client",
      "corpus@example.test",
    );
    const requisitionId = (await openRequisition(client.id, recruiter.user.id))
      .id;
    const texts = await textCorpus();
    expect(texts.length).toBeGreaterThan(30);

    for (const { cv, text } of texts) {
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
          noticeText: cv.noticeDays === null ? null : `${cv.noticeDays} days`,
          noticeDays: cv.noticeDays,
          skills: cv.skills,
        },
      });
      await prisma.cvDocument.create({
        data: {
          batchId: batch.id,
          requisitionId,
          candidateId: candidate.id,
          fileName: cv.file.split("/").pop()!,
          mimeType: "application/pdf",
          sizeBytes: 1,
          sha256: candidate.id,
          data: new Uint8Array([1]),
          text,
          status: "PARSED",
        },
      });
      const application = await prisma.application.create({
        data: {
          candidateId: candidate.id,
          requisitionId,
          stage: "SUBMITTED",
          submittedAt: new Date(),
          submittedById: recruiter.user.id,
          submissionNote: `Strong on the stack. Reachable on ${cv.phone ?? "the usual number"} or ${cv.email ?? "email"}.`,
        },
      });
      const res = await get(
        cookie,
        `/api/portal/applications/${application.id}`,
      );
      expect(res.status, cv.file).toBe(200);
      const json = scan(res.body);
      if (cv.email)
        expect(json.toLowerCase(), cv.file).not.toContain(
          cv.email.toLowerCase(),
        );
      if (cv.phone)
        expect(json.replace(/\D/g, ""), cv.file).not.toContain(
          cv.phone.slice(-10),
        );
      expect(json, cv.file).not.toMatch(ANY_EMAIL);
      expect(json, cv.file).not.toMatch(ANY_PHONE);
      expect(json, cv.file).not.toMatch(/"total"/);

      const cvText: string = res.body.cvText;
      const first = cv.name.split(/\s+/)[0];
      expect(cvText.toLowerCase(), cv.file).toContain(first.toLowerCase());
      expect(cvText, cv.file).not.toMatch(
        /^\s*(date of birth|dob|marital status|gender|father'?s name|nationality)\b/im,
      );
    }
  }, 120_000);

  it("lists the corpus names the client may see, not the agency's other candidates", async () => {
    await candidateAt(
      sahyadriReq,
      recruiter.user.id,
      "SUBMITTED",
      "Not For Kestrel",
    );
    await candidateAt(
      kestrelReq,
      recruiter.user.id,
      "SUBMITTED",
      "For Kestrel",
    );
    const res = await get(
      priya.cookie,
      `/api/portal/requisitions/${kestrelReq}/candidates`,
    );
    expect(res.body.items.map((i: { name: string }) => i.name)).toEqual([
      "For Kestrel",
    ]);
    expect(cvs.length).toBeGreaterThan(30);
  });
});
