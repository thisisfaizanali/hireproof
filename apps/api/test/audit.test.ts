import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import {
  AUDIT_ACTIONS,
  formatReqNumber,
  parseIst,
  type AuditPageView,
} from "@hireproof/shared";
import { app } from "../src/app";
import { describe as sentence } from "../src/auditDescribe";
import { prisma } from "../src/db";
import { resetDb } from "./helpers";
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

let head: Awaited<ReturnType<typeof createStaff>>;
let recruiter: Awaited<ReturnType<typeof createStaff>>;
let hm: Awaited<ReturnType<typeof createClient>>;
let requisition: Awaited<ReturnType<typeof openRequisition>>;

beforeEach(async () => {
  await resetDb();
  head = await createStaff("DELIVERY_HEAD", "head@example.test");
  recruiter = await createStaff("RECRUITER", "recruiter@example.test");
  hm = await createClient("Kestrel", "priya@example.test");
  requisition = await openRequisition(hm.client.id, recruiter.user.id);
});

const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((f) =>
    f.isDirectory()
      ? f.name === "generated"
        ? []
        : sources(join(dir, f.name))
      : f.name.endsWith(".ts")
        ? [join(dir, f.name)]
        : [],
  );

describe("describing events", () => {
  it("has a sentence for every action the code can record", () => {
    const used = new Set(
      sources(join(__dirname, "../src")).flatMap((file) =>
        [...readFileSync(file, "utf8").matchAll(/action: "([A-Z_]+)"/g)].map(
          (m) => m[1],
        ),
      ),
    );
    expect(used.size).toBeGreaterThan(20);
    for (const action of used) {
      expect(action in AUDIT_ACTIONS, `${action} is not listed`).toBe(true);
    }
    for (const action of Object.keys(AUDIT_ACTIONS)) {
      const line = sentence({
        action,
        person: "Ananya Sharma",
        meta: {},
        candidate: "CND-10137",
        requisition: "REQ-0009",
      });
      expect(line, action).not.toBe(action);
      expect(line, action).not.toMatch(/undefined|\[object|NaN/);
    }
  });

  it("reads like a sentence", () => {
    expect(
      sentence({
        action: "CV_VIEWED",
        person: "Ananya Sharma",
        meta: {},
        candidate: "CND-10137",
        requisition: "REQ-0009",
      }),
    ).toBe("Ananya Sharma opened the CV of CND-10137 for REQ-0009");
  });

  it("says so when the candidate has been deleted", () => {
    expect(
      sentence({
        action: "CV_VIEWED",
        person: "Ananya Sharma",
        meta: {},
        candidate: null,
        requisition: "REQ-0009",
      }),
    ).toBe(
      "Ananya Sharma opened the CV of a candidate who has since been deleted for REQ-0009",
    );
  });
});

describe("what the audit trail holds", () => {
  it("never keeps a name, email or phone number, through a whole flow", async () => {
    const day = (n: number) => {
      const wall = new Date(Date.now() + 330 * 60_000 + n * 86_400_000);
      while (wall.getUTCDay() === 0 || wall.getUTCDay() === 6) {
        wall.setUTCDate(wall.getUTCDate() + 1);
      }
      return `${wall.toISOString().slice(0, 10)}T10:00`;
    };
    const names = ["Riya Sen", "Meera Pillai", "Kabir Anand", "Tara Joshi"];
    const [riya, meera, kabir, tara] = [
      await candidateAt(requisition.id, recruiter.user.id, "SOURCED", names[0]),
      await candidateAt(requisition.id, recruiter.user.id, "SOURCED", names[1]),
      await candidateAt(
        requisition.id,
        recruiter.user.id,
        "SUBMITTED",
        names[2],
      ),
      await candidateAt(
        requisition.id,
        recruiter.user.id,
        "SUBMITTED",
        names[3],
      ),
    ];

    // A failed sign in with an address that is not on file.
    await request(app).post("/api/auth/login").send({
      email: "nobody.at.all@example.test",
      password: "wrong-password",
    });

    // Consent for an upload.
    await post(
      recruiter.cookie,
      `/api/requisitions/${requisition.id}/uploads`,
      {
        expectedCount: 1,
        consent: {
          basis: true,
          source: "OTHER",
          sourceNote: `Riya Sen at ${EMAIL}`,
        },
      },
    );

    // Reading, screening, submitting and withdrawing.
    await get(recruiter.cookie, `/api/candidates/${riya.candidate.id}`);
    await get(recruiter.cookie, `/api/cvs/${riya.cv.id}/text`);
    await post(
      recruiter.cookie,
      `/api/applications/${riya.application.id}/screen`,
    );
    await post(
      recruiter.cookie,
      `/api/applications/${riya.application.id}/submit`,
      { note: `Riya Sen is reachable on ${PHONE} or ${EMAIL} and ready.` },
    );
    await post(
      recruiter.cookie,
      `/api/applications/${riya.application.id}/withdraw`,
    );
    await post(
      recruiter.cookie,
      `/api/applications/${meera.application.id}/reject`,
      {
        reason: "OTHER",
        note: `Meera Pillai did not answer on ${PHONE}`,
      },
    );
    await post(
      recruiter.cookie,
      `/api/applications/${meera.application.id}/reopen`,
    );

    // The client side.
    await get(hm.cookie, `/api/portal/applications/${kabir.application.id}`);
    await post(
      hm.cookie,
      `/api/portal/applications/${kabir.application.id}/slots`,
      {
        slots: [
          {
            startsAt: day(4),
            durationMinutes: 45,
            mode: "VIDEO",
            note: "Kabir Anand",
          },
        ],
      },
    );
    const slot = await prisma.interviewSlot.findFirstOrThrow();
    await post(recruiter.cookie, `/api/slots/${slot.id}/confirm`);
    await post(
      recruiter.cookie,
      `/api/applications/${kabir.application.id}/move`,
      {
        to: "OFFERED",
      },
    );
    await post(
      hm.cookie,
      `/api/portal/applications/${tara.application.id}/reject`,
      {
        reason: "OTHER",
        note: `Tara Joshi, ${EMAIL}`,
      },
    );

    // The delivery head.
    await post(head.cookie, "/api/insights/sample/x/review", {});
    await request(app)
      .delete(`/api/candidates/${tara.candidate.id}`)
      .set("Cookie", head.cookie)
      .send({ reason: "CANDIDATE_REQUEST", confirmCode: tara.candidate.code });

    const events = await prisma.auditEvent.findMany();
    const seen = new Set(events.map((e) => e.action));
    for (const action of [
      "LOGIN_FAILED",
      "UPLOAD_CONSENT_RECORDED",
      "CANDIDATE_PROFILE_VIEWED",
      "CV_VIEWED",
      "APPLICATION_SCREENED",
      "APPLICATION_SUBMITTED",
      "SUBMISSION_WITHDRAWN",
      "APPLICATION_REJECTED",
      "APPLICATION_REOPENED",
      "CLIENT_CANDIDATE_VIEWED",
      "CLIENT_SHORTLISTED",
      "SLOT_PROPOSED",
      "SLOT_CONFIRMED",
      "STAGE_CHANGED",
      "MESSAGE_RECORDED",
      "CLIENT_REJECTED",
      "CANDIDATE_DELETED",
    ]) {
      expect(seen.has(action), `${action} was not recorded`).toBe(true);
    }

    for (const e of events) {
      const meta = JSON.stringify(e.meta ?? {});
      for (const secret of [
        ...names,
        ...names.map((n) => n.split(" ")[1]),
        EMAIL,
        PHONE,
        "nobody.at.all",
      ]) {
        // Whole words, so a short surname is not found inside a key name.
        const escaped = secret.replaceAll(".", String.raw`\.`);
        const found = new RegExp(String.raw`\b${escaped}\b`, "i");
        expect(meta, `${e.action} holds ${secret}`).not.toMatch(found);
      }
      expect(meta, e.action).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
      expect(meta, e.action).not.toMatch(/\d{10}/);
    }
  });
});

describe("the audit log", () => {
  // Signing in to set the test up left events behind.
  beforeEach(async () => {
    await prisma.auditEvent.deleteMany();
  });

  const log = async (query = "") => {
    const res = await get(head.cookie, `/api/audit${query}`);
    expect(res.status).toBe(200);
    return res.body as AuditPageView;
  };
  const event = (over: Record<string, unknown> = {}) =>
    prisma.auditEvent.create({
      data: {
        actorId: recruiter.user.id,
        action: "CV_VIEWED",
        ip: "10.0.0.7",
        ...over,
      },
    });

  it("shows newest first as sentences with the person, the time and the address", async () => {
    const { candidate, cv } = await candidateAt(
      requisition.id,
      recruiter.user.id,
      "SOURCED",
      "Riya Sen",
    );
    await event({
      entityType: "CvDocument",
      entityId: cv.id,
      meta: { candidateId: candidate.id, requisitionId: requisition.id },
      createdAt: parseIst("2026-11-03T10:00")!,
    });
    await event({
      action: "LOGOUT",
      createdAt: parseIst("2026-11-03T18:00")!,
    });
    const page = await log();
    expect(page.rows.map((r) => r.sentence)).toEqual([
      "Test RECRUITER signed out",
      `Test RECRUITER opened the CV of ${candidate.code} for ${formatReqNumber(requisition.number)}`,
    ]);
    expect(page.rows[0]).toMatchObject({
      person: "Test RECRUITER",
      ip: "10.0.0.7",
    });
    expect(page.total).toBe(2);
    expect(page.people.map((p) => p.name)).toContain("Test DELIVERY_HEAD");
  });

  it("pages 50 at a time", async () => {
    await prisma.auditEvent.createMany({
      data: Array.from({ length: 120 }, (_, i) => ({
        action: "LOGOUT",
        actorId: recruiter.user.id,
        createdAt: new Date(Date.UTC(2026, 10, 3, 0, 0, i)),
      })),
    });
    const first = await log();
    const last = await log("?page=3");
    expect(first.rows).toHaveLength(50);
    expect(first.total).toBe(120);
    expect(last.rows).toHaveLength(20);
    expect(first.rows[0].at > first.rows[49].at).toBe(true);
  });

  it("filters by person, action and a date range read in IST", async () => {
    await event({ action: "LOGOUT", createdAt: parseIst("2026-11-01T23:30")! });
    await event({ action: "LOGOUT", createdAt: parseIst("2026-11-02T00:10")! });
    await event({
      action: "LOGIN_SUCCEEDED",
      actorId: head.user.id,
      createdAt: parseIst("2026-11-02T09:00")!,
    });
    expect((await log(`?person=${head.user.id}`)).total).toBe(1);
    expect((await log("?action=LOGOUT")).total).toBe(2);
    expect((await log("?from=2026-11-02&to=2026-11-02")).total).toBe(2);
    expect((await log("?from=2026-11-01&to=2026-11-01")).total).toBe(1);
    expect((await get(head.cookie, "/api/audit?action=NOPE")).status).toBe(400);
  });

  it("finds what concerns a candidate code or a requisition number", async () => {
    const mine = await candidateAt(
      requisition.id,
      recruiter.user.id,
      "SOURCED",
      "Riya Sen",
    );
    const other = await candidateAt(
      requisition.id,
      recruiter.user.id,
      "SOURCED",
      "Meera Pillai",
    );
    await event({
      entityType: "CvDocument",
      entityId: mine.cv.id,
      meta: { candidateId: mine.candidate.id, requisitionId: requisition.id },
    });
    await event({
      action: "APPLICATION_SCREENED",
      entityType: "Application",
      entityId: mine.application.id,
      meta: { band: "STRONG" },
    });
    await event({
      entityType: "CvDocument",
      entityId: other.cv.id,
      meta: { candidateId: other.candidate.id, requisitionId: requisition.id },
    });
    expect((await log(`?subject=${mine.candidate.code}`)).total).toBe(2);
    expect(
      (await log(`?subject=${mine.candidate.code.toLowerCase()}`)).total,
    ).toBe(2);
    expect(
      (await log(`?subject=${formatReqNumber(requisition.number)}`)).total,
    ).toBe(3);
    const none = await log("?subject=CND-99999");
    expect(none.total).toBe(0);
    expect(none.subjectNote).toMatch(/no candidate/i);
    expect((await log("?subject=hello")).subjectNote).toMatch(
      /enter a candidate code/i,
    );
  });

  it("keeps the trail of an erased candidate readable and findable by code", async () => {
    const made = await candidateAt(
      requisition.id,
      recruiter.user.id,
      "SOURCED",
      "Riya Sen",
    );
    await event({
      entityType: "CvDocument",
      entityId: made.cv.id,
      meta: { candidateId: made.candidate.id, requisitionId: requisition.id },
    });
    await request(app)
      .delete(`/api/candidates/${made.candidate.id}`)
      .set("Cookie", head.cookie)
      .send({ reason: "RETENTION_ENDED", confirmCode: made.candidate.code });

    const page = await log();
    expect(page.rows.map((r) => r.sentence)).toEqual([
      `Test DELIVERY_HEAD deleted all data held on ${made.candidate.code}, reason: retention period ended`,
      `Test RECRUITER opened the CV of a candidate who has since been deleted for ${formatReqNumber(requisition.number)}`,
    ]);
    expect((await log(`?subject=${made.candidate.code}`)).total).toBe(1);
  });

  it("is for the delivery head alone", async () => {
    for (const who of [recruiter.cookie, hm.cookie]) {
      expect((await get(who, "/api/audit")).status).toBe(403);
    }
    expect((await request(app).get("/api/audit")).status).toBe(401);
  });
});

describe("data retention", () => {
  const monthsAgo = (n: number) => {
    const d = new Date();
    d.setUTCMonth(d.getUTCMonth() - n);
    return d;
  };

  it("lists candidates twelve months past their last activity, oldest first, with recent deletions", async () => {
    const old = await candidateAt(
      requisition.id,
      recruiter.user.id,
      "SOURCED",
      "Old One",
    );
    const older = await candidateAt(
      requisition.id,
      recruiter.user.id,
      "SOURCED",
      "Older One",
    );
    const fresh = await candidateAt(
      requisition.id,
      recruiter.user.id,
      "SOURCED",
      "Fresh One",
    );
    await prisma.candidate.update({
      where: { id: old.candidate.id },
      data: { lastActivityAt: monthsAgo(13) },
    });
    await prisma.candidate.update({
      where: { id: older.candidate.id },
      data: { lastActivityAt: monthsAgo(20) },
    });
    await prisma.candidate.update({
      where: { id: fresh.candidate.id },
      data: { lastActivityAt: monthsAgo(11) },
    });
    await prisma.deletionRecord.create({
      data: {
        candidateCode: "CND-10001",
        reason: "CANDIDATE_REQUEST",
        deletedById: head.user.id,
        counts: { cvs: 1 },
      },
    });
    const res = await get(head.cookie, "/api/data/retention");
    expect(res.status).toBe(200);
    expect(res.body.expired.map((c: { name: string }) => c.name)).toEqual([
      "Older One",
      "Old One",
    ]);
    expect(res.body.expiredTotal).toBe(2);
    expect(res.body.expired[1].retainUntil < new Date().toISOString()).toBe(
      true,
    );
    expect(res.body.deletions).toMatchObject([
      {
        candidateCode: "CND-10001",
        reason: "CANDIDATE_REQUEST",
        deletedBy: "Test DELIVERY_HEAD",
      },
    ]);
  });

  it("moves a candidate's retention date when they are screened", async () => {
    const made = await candidateAt(
      requisition.id,
      recruiter.user.id,
      "SOURCED",
      "Riya Sen",
    );
    await prisma.candidate.update({
      where: { id: made.candidate.id },
      data: { lastActivityAt: monthsAgo(14) },
    });
    await get(recruiter.cookie, `/api/cvs/${made.cv.id}/text`);
    await post(
      recruiter.cookie,
      `/api/applications/${made.application.id}/screen`,
    );
    const after = await prisma.candidate.findUniqueOrThrow({
      where: { id: made.candidate.id },
    });
    expect(after.lastActivityAt.getTime()).toBeGreaterThan(
      monthsAgo(1).getTime(),
    );
  });

  it("is for the delivery head alone", async () => {
    for (const who of [recruiter.cookie, hm.cookie]) {
      expect((await get(who, "/api/data/retention")).status).toBe(403);
    }
  });
});
