import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import {
  parseIst,
  weekRange,
  weekStartOf,
  type DecisionAction,
  type WeekInsights,
} from "@hireproof/shared";
import { app } from "../src/app";
import { prisma } from "../src/db";
import { agreementTable } from "../src/insightsCalc";
import { resetDb } from "./helpers";
import {
  candidateAt,
  createClient,
  createStaff,
  get,
  openRequisition,
  post,
} from "./pipelineHelpers";

const WEEK = "2026-11-02";
const LAST = "2026-10-26";
const tuesday = (hour = 10) => parseIst(`2026-11-03T${hour}:00`)!;

let head: Awaited<ReturnType<typeof createStaff>>;
let recruiter: Awaited<ReturnType<typeof createStaff>>;
let hm: Awaited<ReturnType<typeof createClient>>;
let requisitionId: string;
let n = 0;

beforeEach(async () => {
  await resetDb();
  n = 0;
  head = await createStaff("DELIVERY_HEAD", "head@example.test");
  recruiter = await createStaff("RECRUITER", "recruiter@example.test");
  hm = await createClient("Kestrel", "priya@example.test");
  requisitionId = (await openRequisition(hm.client.id, recruiter.user.id)).id;
});

type Band = "STRONG" | "POSSIBLE" | "WEAK" | "NOT_SCORED";

// An application with one decision recorded against it, as the routes record it.
async function decided(
  action: DecisionAction,
  band: Band,
  when = tuesday(),
  extra: Record<string, unknown> = {},
) {
  const made = await candidateAt(
    requisitionId,
    recruiter.user.id,
    "SOURCED",
    `Candidate ${++n}`,
  );
  await decide(made.application.id, action, band, when, extra);
  return made;
}

const decide = (
  applicationId: string,
  action: DecisionAction,
  band: Band,
  when: Date,
  extra: Record<string, unknown> = {},
) =>
  prisma.auditEvent.create({
    data: {
      actorId: recruiter.user.id,
      action,
      entityType: "Application",
      entityId: applicationId,
      createdAt: when,
      meta: {
        band: band === "NOT_SCORED" ? null : band,
        total: band === "STRONG" ? 88 : band === "POSSIBLE" ? 61 : 30,
        ...extra,
      },
    },
  });

const week = async (start = WEEK) => {
  const res = await get(head.cookie, `/api/insights/week?start=${start}`);
  expect(res.status).toBe(200);
  return res.body as WeekInsights;
};

describe("weeks in IST", () => {
  it("starts on Monday at midnight IST and ends on Sunday night", () => {
    const { from, to } = weekRange(WEEK);
    expect(from.toISOString()).toBe("2026-11-01T18:30:00.000Z");
    expect(to.toISOString()).toBe("2026-11-08T18:30:00.000Z");
  });

  it("names the week of an instant by its Monday in IST", () => {
    expect(weekStartOf(parseIst("2026-11-01T23:30")!)).toBe(LAST);
    expect(weekStartOf(parseIst("2026-11-02T00:10")!)).toBe(WEEK);
    expect(weekStartOf(parseIst("2026-11-08T23:59")!)).toBe(WEEK);
  });

  it("puts Sunday 23:30 IST and Monday 00:10 IST in different weeks", async () => {
    await decided(
      "APPLICATION_SCREENED",
      "STRONG",
      parseIst("2026-11-01T23:30")!,
    );
    await decided(
      "APPLICATION_SCREENED",
      "STRONG",
      parseIst("2026-11-02T00:10")!,
    );
    // Both fall on 1 November in UTC.
    const last = await week(LAST);
    const this_ = await week(WEEK);
    expect(last.agreement.rows[0].screened).toBe(1);
    expect(this_.agreement.rows[0].screened).toBe(1);
  });

  it("refuses a start that is not a Monday", async () => {
    const res = await get(head.cookie, "/api/insights/week?start=2026-11-03");
    expect(res.status).toBe(400);
  });
});

describe("the agreement table", () => {
  it("counts each decision under the AI band at the time and states the rate", async () => {
    const plan: [DecisionAction, Band, number][] = [
      ["APPLICATION_SCREENED", "STRONG", 3],
      ["APPLICATION_REJECTED", "STRONG", 1],
      ["APPLICATION_SCREENED", "POSSIBLE", 2],
      ["APPLICATION_REJECTED", "POSSIBLE", 1],
      ["APPLICATION_REJECTED", "WEAK", 2],
      ["APPLICATION_SCREENED", "WEAK", 1],
      ["APPLICATION_SCREENED", "NOT_SCORED", 1],
      ["APPLICATION_SUBMITTED", "STRONG", 2],
      ["CLIENT_SHORTLISTED", "STRONG", 1],
      ["CLIENT_REJECTED", "WEAK", 1],
    ];
    for (const [action, band, count] of plan) {
      for (let i = 0; i < count; i++) await decided(action, band);
    }
    const { agreement } = await week();
    expect(agreement.rows).toEqual([
      {
        band: "STRONG",
        screened: 3,
        rejected: 1,
        submitted: 2,
        shortlisted: 1,
        clientRejected: 0,
      },
      {
        band: "POSSIBLE",
        screened: 2,
        rejected: 1,
        submitted: 0,
        shortlisted: 0,
        clientRejected: 0,
      },
      {
        band: "WEAK",
        screened: 1,
        rejected: 2,
        submitted: 0,
        shortlisted: 0,
        clientRejected: 1,
      },
      {
        band: "NOT_SCORED",
        screened: 1,
        rejected: 0,
        submitted: 0,
        shortlisted: 0,
        clientRejected: 0,
      },
    ]);
    // Agreed: Strong and Possible screened (3 + 2) and Weak rejected (2).
    // Compared: every scored screened or rejected decision (10).
    expect(agreement.agreed).toBe(7);
    expect(agreement.compared).toBe(10);
  });

  it("is computed the same from a bare list", () => {
    expect(
      agreementTable([
        { action: "APPLICATION_SCREENED", band: "STRONG" },
        { action: "APPLICATION_REJECTED", band: "STRONG" },
      ]),
    ).toMatchObject({ agreed: 1, compared: 2 });
  });

  it("leaves out decisions from other weeks", async () => {
    await decided(
      "APPLICATION_SCREENED",
      "STRONG",
      parseIst("2026-10-28T10:00")!,
    );
    await decided("APPLICATION_SCREENED", "STRONG");
    expect((await week()).agreement.compared).toBe(1);
  });

  it("is empty for a week with nothing in it", async () => {
    const empty = await week("2026-09-07");
    expect(empty.agreement.compared).toBe(0);
    expect(empty.sample.items).toEqual([]);
    expect(empty.disagreements).toEqual([]);
  });
});

describe("disagreements", () => {
  it("lists a Strong match turned down, with the reason, and a Weak match moved on", async () => {
    await decided("APPLICATION_REJECTED", "STRONG", tuesday(), {
      reason: "NOTICE_PERIOD",
    });
    await decided("APPLICATION_SUBMITTED", "WEAK");
    await decided("CLIENT_SHORTLISTED", "WEAK");
    await decided("APPLICATION_SCREENED", "STRONG");
    await decided("APPLICATION_REJECTED", "WEAK", tuesday(), {
      reason: "SKILLS_GAP",
    });

    const { disagreements } = await week();
    expect(
      disagreements.map((d) => [d.band, d.action, d.reason]).sort(),
    ).toEqual(
      [
        ["STRONG", "APPLICATION_REJECTED", "Notice period"],
        ["WEAK", "APPLICATION_SUBMITTED", null],
        ["WEAK", "CLIENT_SHORTLISTED", null],
      ].sort(),
    );
    expect(disagreements[0]).toMatchObject({ by: "Test RECRUITER" });
    expect(disagreements[0].cvId).toEqual(expect.any(String));
  });
});

describe("the weekly sample", () => {
  async function crowd(agreements: number, disagreements: number) {
    for (let i = 0; i < agreements; i++) {
      await decided("APPLICATION_SCREENED", "STRONG");
    }
    for (let i = 0; i < disagreements; i++) {
      await decided("APPLICATION_REJECTED", "STRONG", tuesday(), {
        reason: "OTHER",
      });
    }
  }

  it("holds ten decisions, disagreements first, the same ten on every load", async () => {
    await crowd(15, 3);
    const first = (await week()).sample;
    const again = (await week()).sample;
    expect(first.items).toHaveLength(10);
    expect(first.items.map((i) => i.applicationId)).toEqual(
      again.items.map((i) => i.applicationId),
    );
    expect(first.items.slice(0, 3).every((i) => i.disagreement)).toBe(true);
    expect(first.items.slice(3).every((i) => !i.disagreement)).toBe(true);
  });

  it("is smaller when the week has fewer decisions, and drops to ten when disagreements alone are many", async () => {
    await crowd(2, 1);
    expect((await week()).sample.items).toHaveLength(3);
    await crowd(0, 14);
    const sample = (await week()).sample.items;
    expect(sample).toHaveLength(10);
    expect(sample.every((i) => i.disagreement)).toBe(true);
  });

  it("does not pick a decision whose AI band is missing", async () => {
    await decided("APPLICATION_SCREENED", "NOT_SCORED");
    expect((await week()).sample.items).toEqual([]);
  });

  it("takes a verdict, keeps it on reload, and counts progress and the running tally", async () => {
    await crowd(4, 2);
    const items = (await week()).sample.items;
    const review = (id: string, body: object) =>
      post(head.cookie, `/api/insights/sample/${id}/review`, {
        weekStart: WEEK,
        ...body,
      });
    expect(
      (await review(items[0].applicationId, { verdict: "AI_RIGHT" })).status,
    ).toBe(200);
    await review(items[1].applicationId, {
      verdict: "BOTH_REASONABLE",
      note: "Notice period was the whole story",
    });

    const after = (await week()).sample;
    expect(after.reviewed).toBe(2);
    expect(after.items.map((i) => i.applicationId)).toEqual(
      items.map((i) => i.applicationId),
    );
    expect(after.items[1].review).toEqual({
      verdict: "BOTH_REASONABLE",
      note: "Notice period was the whole story",
    });
    expect(after.tally).toEqual({
      AI_RIGHT: 1,
      RECRUITER_RIGHT: 0,
      BOTH_REASONABLE: 1,
    });
  });

  it("keeps one review per week and application, and takes the later verdict", async () => {
    await crowd(1, 0);
    const [item] = (await week()).sample.items;
    const url = `/api/insights/sample/${item.applicationId}/review`;
    await post(head.cookie, url, { weekStart: WEEK, verdict: "AI_RIGHT" });
    await post(head.cookie, url, {
      weekStart: WEEK,
      verdict: "RECRUITER_RIGHT",
    });
    const rows = await prisma.sampleReview.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      verdict: "RECRUITER_RIGHT",
      band: "STRONG",
      decision: "APPLICATION_SCREENED",
      requisitionNumber: expect.any(Number),
      reviewedById: head.user.id,
    });
  });

  it("keeps what was reviewed in the sample when more decisions arrive", async () => {
    await crowd(10, 0);
    const [first] = (await week()).sample.items;
    await post(
      head.cookie,
      `/api/insights/sample/${first.applicationId}/review`,
      {
        weekStart: WEEK,
        verdict: "AI_RIGHT",
      },
    );
    await crowd(0, 4);
    const after = (await week()).sample.items;
    expect(after).toHaveLength(10);
    expect(after.map((i) => i.applicationId)).toContain(first.applicationId);
  });

  it("will not take a review for a decision outside the sample or a bad verdict", async () => {
    await crowd(2, 0);
    const outside = await candidateAt(
      requisitionId,
      recruiter.user.id,
      "SOURCED",
      "Not sampled",
    );
    const url = (id: string) => `/api/insights/sample/${id}/review`;
    expect(
      (
        await post(head.cookie, url(outside.application.id), {
          weekStart: WEEK,
          verdict: "AI_RIGHT",
        })
      ).status,
    ).toBe(404);
    const [item] = (await week()).sample.items;
    expect(
      (
        await post(head.cookie, url(item.applicationId), {
          weekStart: WEEK,
          verdict: "MAYBE",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await post(head.cookie, url(item.applicationId), {
          weekStart: "2026-11-03",
          verdict: "AI_RIGHT",
        })
      ).status,
    ).toBe(400);
    expect(await prisma.sampleReview.count()).toBe(0);
  });

  it("logs a review in the audit trail without the note", async () => {
    await crowd(1, 0);
    const [item] = (await week()).sample.items;
    await post(
      head.cookie,
      `/api/insights/sample/${item.applicationId}/review`,
      {
        weekStart: WEEK,
        verdict: "AI_RIGHT",
        note: "Looks right to me",
      },
    );
    const event = await prisma.auditEvent.findFirstOrThrow({
      where: { action: "SAMPLE_REVIEWED" },
    });
    expect(event.meta).toEqual({ weekStart: WEEK, verdict: "AI_RIGHT" });
  });
});

describe("top ten overlap", () => {
  it("counts how many of the AI's top ten were screened and lists the screened ones it ranked lower", async () => {
    const people = [];
    for (let i = 0; i < 12; i++) {
      const made = await candidateAt(
        requisitionId,
        recruiter.user.id,
        "SOURCED",
        `Ranked ${i + 1}`,
      );
      // Totals fall by rank, so rank 1 is the highest.
      await prisma.candidateScore.updateMany({
        where: { applicationId: made.application.id },
        data: { total: 90 - i, band: i < 6 ? "STRONG" : "POSSIBLE" },
      });
      people.push(made);
    }
    // Screened: ranks 1, 2, 3, 10 (in the top ten) and 11, 12 (outside it).
    for (const rank of [1, 2, 3, 10, 11, 12]) {
      await decide(
        people[rank - 1].application.id,
        "APPLICATION_SCREENED",
        "STRONG",
        tuesday(),
      );
    }
    const { overlap } = await week();
    expect(overlap).toHaveLength(1);
    expect(overlap[0]).toMatchObject({ topSize: 10, screenedInTop: 4 });
    expect(overlap[0].outside.map((c) => c.code)).toEqual(
      [people[10], people[11]].map((p) => p.candidate.code).sort(),
    );
  });

  it("does not count a candidate who was only screened after the week ended", async () => {
    const made = await candidateAt(
      requisitionId,
      recruiter.user.id,
      "SOURCED",
      "Late",
    );
    const other = await decided("APPLICATION_REJECTED", "WEAK");
    await decide(
      made.application.id,
      "APPLICATION_SCREENED",
      "STRONG",
      parseIst("2026-11-10T10:00")!,
    );
    const [row] = (await week()).overlap;
    expect(row.screenedInTop).toBe(0);
    expect(row.outside).toEqual([]);
    expect(other).toBeTruthy();
  });
});

describe("AI health and the funnel", () => {
  it("counts scores by source, runs by outcome, tokens and quote checks for the week", async () => {
    const made = await candidateAt(
      requisitionId,
      recruiter.user.id,
      "SOURCED",
      "Health",
    );
    await prisma.candidateScore.update({
      where: {
        applicationId_scorecardVersion: {
          applicationId: made.application.id,
          scorecardVersion: 1,
        },
      },
      data: { createdAt: tuesday(), source: "AI" },
    });
    await prisma.aiRun.createMany({
      data: [
        {
          kind: "CV_SCORE",
          model: "m",
          outcome: "OK",
          latencyMs: 10,
          inputTokens: 1000,
          outputTokens: 100,
          createdAt: tuesday(),
        },
        {
          kind: "CV_SCORE",
          model: "m",
          outcome: "PROVIDER_ERROR",
          latencyMs: 10,
          createdAt: tuesday(),
        },
        {
          kind: "CV_PARSE",
          model: "m",
          outcome: "OK",
          latencyMs: 10,
          inputTokens: 500,
          outputTokens: 50,
          createdAt: parseIst("2026-10-20T10:00")!,
        },
      ],
    });
    const { health } = await week();
    expect(health.scoresBySource).toEqual({ AI: 1, RULES: 0 });
    expect(health.runs).toEqual(
      expect.arrayContaining([
        { kind: "CV_SCORE", outcome: "OK", count: 1 },
        { kind: "CV_SCORE", outcome: "PROVIDER_ERROR", count: 1 },
      ]),
    );
    expect(health.runs).toHaveLength(2);
    expect(health.inputTokens).toBe(1000);
    expect(health.outputTokens).toBe(100);
    // The fixture score has one verified and one unverified quote.
    expect(health.quotes).toEqual({ total: 2, verified: 1 });
  });

  it("counts the stages people moved candidates through in the week", async () => {
    await decided("APPLICATION_SCREENED", "STRONG");
    await decided("APPLICATION_SUBMITTED", "STRONG");
    await decided("CLIENT_SHORTLISTED", "STRONG");
    const moved = await candidateAt(
      requisitionId,
      recruiter.user.id,
      "INTERVIEW",
      "Moved",
    );
    for (const to of ["INTERVIEW", "OFFERED", "JOINED"]) {
      await prisma.auditEvent.create({
        data: {
          actorId: recruiter.user.id,
          action: "STAGE_CHANGED",
          entityType: "Application",
          entityId: moved.application.id,
          createdAt: tuesday(),
          meta: { to },
        },
      });
    }
    await prisma.application.updateMany({
      data: { createdAt: tuesday() },
    });
    expect((await week()).funnel).toEqual({
      sourced: 4,
      screened: 1,
      submitted: 1,
      shortlisted: 1,
      interview: 1,
      offered: 1,
      joined: 1,
    });
  });
});

describe("access", () => {
  const routes: ["get" | "post", string][] = [
    ["get", "/api/insights/week"],
    ["post", "/api/insights/sample/x/review"],
  ];

  it.each(routes)(
    "%s %s is for the delivery head alone",
    async (method, path) => {
      for (const who of [recruiter.cookie, hm.cookie]) {
        const res = await request(app)
          [method](path)
          .set("Cookie", who)
          .send({});
        expect(res.status).toBe(403);
      }
      expect((await request(app)[method](path).send({})).status).toBe(401);
    },
  );
});
