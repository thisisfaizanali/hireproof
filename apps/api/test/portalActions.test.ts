import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/db";
import { resetDb } from "./helpers";
import {
  candidateAt,
  createClient,
  createStaff,
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

const submitted = (name = "Riya Sen", requisition = kestrelReq) =>
  candidateAt(requisition, recruiter.user.id, "SUBMITTED", name);
const stageOf = async (id: string) =>
  (await prisma.application.findUniqueOrThrow({ where: { id } })).stage;

// A weekday at least a week away, as the wall clock in India reads it.
function ist(time: string, plusDays = 7, weekday?: number) {
  const wall = new Date(Date.now() + 330 * 60_000 + plusDays * 86_400_000);
  while (
    weekday === undefined
      ? wall.getUTCDay() === 0 || wall.getUTCDay() === 6
      : wall.getUTCDay() !== weekday
  ) {
    wall.setUTCDate(wall.getUTCDate() + 1);
  }
  return `${wall.toISOString().slice(0, 10)}T${time}`;
}

const slot = (startsAt: string, over: object = {}) => ({
  startsAt,
  durationMinutes: 45,
  mode: "VIDEO",
  ...over,
});

describe("shortlisting", () => {
  it("moves a submitted candidate to shortlisted and is audited", async () => {
    const { application } = await submitted();
    const res = await post(
      priya.cookie,
      `/api/portal/applications/${application.id}/shortlist`,
    );
    expect(res.status).toBe(200);
    expect(await stageOf(application.id)).toBe("CLIENT_SHORTLISTED");
    expect(
      await prisma.auditEvent.count({
        where: {
          action: "CLIENT_SHORTLISTED",
          actorId: priya.user.id,
          entityId: application.id,
        },
      }),
    ).toBe(1);
  });

  it("cannot be undone or repeated by the client", async () => {
    const { application } = await submitted();
    const url = `/api/portal/applications/${application.id}`;
    await post(priya.cookie, `${url}/shortlist`);
    expect((await post(priya.cookie, `${url}/shortlist`)).status).toBe(409);
    const reject = await post(priya.cookie, `${url}/reject`, {
      reason: "SKILLS_GAP",
    });
    expect(reject.status).toBe(409);
    expect(reject.body.error).toMatch(/Ask your recruiter/);
    expect(await stageOf(application.id)).toBe("CLIENT_SHORTLISTED");
  });
});

describe("rejecting", () => {
  it.each([
    "SKILLS_GAP",
    "EXPERIENCE",
    "NOTICE_PERIOD",
    "CTC",
    "LOCATION",
    "ALREADY_INTERVIEWED",
  ] as const)("records %s as a client rejection", async (reason) => {
    const { application } = await submitted();
    const res = await post(
      priya.cookie,
      `/api/portal/applications/${application.id}/reject`,
      { reason },
    );
    expect(res.status).toBe(200);
    expect(
      await prisma.application.findUniqueOrThrow({
        where: { id: application.id },
      }),
    ).toMatchObject({
      stage: "REJECTED",
      rejectedBy: "CLIENT",
      clientRejectReason: reason,
      // The recruiter's own fields stay untouched.
      rejectReason: null,
      decidedById: null,
    });
    expect(
      await prisma.auditEvent.findFirstOrThrow({
        where: { action: "CLIENT_REJECTED", entityId: application.id },
      }),
    ).toMatchObject({ actorId: priya.user.id, meta: { reason } });
  });

  it("needs a reason, and a note for Other", async () => {
    const { application } = await submitted();
    const url = `/api/portal/applications/${application.id}/reject`;
    expect((await post(priya.cookie, url, {})).status).toBe(400);
    expect((await post(priya.cookie, url, { reason: "BORED" })).status).toBe(
      400,
    );
    const noNote = await post(priya.cookie, url, { reason: "OTHER" });
    expect(noNote.status).toBe(400);
    expect(noNote.body.fields.note).toBe("Say why in a few words");
    expect(await stageOf(application.id)).toBe("SUBMITTED");
    const ok = await post(priya.cookie, url, {
      reason: "OTHER",
      note: "Hiring freeze on this team",
    });
    expect(ok.status).toBe(200);
    expect(
      (
        await prisma.application.findUniqueOrThrow({
          where: { id: application.id },
        })
      ).clientRejectNote,
    ).toBe("Hiring freeze on this team");
  });

  it("is visible to the recruiter in the list as a client decision", async () => {
    const { application } = await submitted();
    await post(
      priya.cookie,
      `/api/portal/applications/${application.id}/reject`,
      { reason: "NOTICE_PERIOD" },
    );
    const row = await prisma.application.findUniqueOrThrow({
      where: { id: application.id },
    });
    expect(row.rejectedBy).toBe("CLIENT");
    expect(row.clientRejectReason).toBe("NOTICE_PERIOD");
  });
});

describe("proposing interview times", () => {
  it("shortlists a submitted candidate and stores each slot in IST", async () => {
    const { application } = await submitted();
    const res = await post(
      priya.cookie,
      `/api/portal/applications/${application.id}/slots`,
      {
        slots: [
          slot(ist("10:30"), { note: "Meet the team lead" }),
          slot(ist("15:00", 8), { mode: "IN_PERSON", durationMinutes: 60 }),
        ],
      },
    );
    expect(res.status).toBe(201);
    expect(await stageOf(application.id)).toBe("CLIENT_SHORTLISTED");
    const rows = await prisma.interviewSlot.findMany({
      where: { applicationId: application.id },
      orderBy: { startsAt: "asc" },
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      status: "PROPOSED",
      durationMinutes: 45,
      mode: "VIDEO",
      note: "Meet the team lead",
      proposedById: priya.user.id,
    });
    // 10:30 in India is 05:00 UTC.
    expect(rows[0].startsAt.toISOString().slice(11, 16)).toBe("05:00");
    expect(
      await prisma.auditEvent.count({
        where: { action: "SLOT_PROPOSED", entityId: application.id },
      }),
    ).toBe(1);
    expect(
      await prisma.auditEvent.count({
        where: { action: "CLIENT_SHORTLISTED", entityId: application.id },
      }),
    ).toBe(1);
  });

  it("works on a candidate already shortlisted, once", async () => {
    const { application } = await candidateAt(
      kestrelReq,
      recruiter.user.id,
      "CLIENT_SHORTLISTED",
    );
    const url = `/api/portal/applications/${application.id}/slots`;
    expect(
      (await post(priya.cookie, url, { slots: [slot(ist("11:00"))] })).status,
    ).toBe(201);
    const again = await post(priya.cookie, url, {
      slots: [slot(ist("12:00"))],
    });
    expect(again.status).toBe(409);
    expect(again.body.error).toMatch(/already proposed/);
  });

  it.each(["INTERVIEW", "OFFERED", "REJECTED"] as const)(
    "is refused for a candidate who is %s",
    async (stage) => {
      const { application } = await candidateAt(
        kestrelReq,
        recruiter.user.id,
        stage,
      );
      const res = await post(
        priya.cookie,
        `/api/portal/applications/${application.id}/slots`,
        { slots: [slot(ist("10:00"))] },
      );
      expect(res.status).toBe(409);
      expect(
        await prisma.interviewSlot.count({
          where: { applicationId: application.id },
        }),
      ).toBe(0);
    },
  );

  describe("refuses a time that is", () => {
    const cases: [string, string, object?][] = [
      ["in the past", "2020-01-06T10:00"],
      ["on a Saturday", ist("10:00", 7, 6)],
      ["on a Sunday", ist("10:00", 7, 0)],
      ["before 9:00 IST", ist("08:30")],
      ["after 19:00 IST", ist("19:30")],
      ["too late to finish by 19:00", ist("18:30"), { durationMinutes: 60 }],
      ["not a time", "next Tuesday"],
      ["not a real date", "2031-02-31T10:00"],
    ];
    it.each(cases)("%s", async (_name, startsAt, over = {}) => {
      const { application } = await submitted();
      const res = await post(
        priya.cookie,
        `/api/portal/applications/${application.id}/slots`,
        { slots: [slot(startsAt, over)] },
      );
      expect(res.status).toBe(400);
      expect(res.body.fields["slots.0.startsAt"]).toBeTruthy();
      expect(await stageOf(application.id)).toBe("SUBMITTED");
    });
  });

  it("accepts the edges of the day: 9:00 and a slot ending at 19:00", async () => {
    const { application } = await submitted();
    const res = await post(
      priya.cookie,
      `/api/portal/applications/${application.id}/slots`,
      {
        slots: [
          slot(ist("09:00")),
          slot(ist("18:15", 8), { durationMinutes: 45 }),
        ],
      },
    );
    expect(res.status).toBe(201);
  });

  it("takes one to three slots, a listed duration, a mode and a short note", async () => {
    const { application } = await submitted();
    const url = `/api/portal/applications/${application.id}/slots`;
    const four = [10, 11, 12, 13].map((h) => slot(ist(`${h}:00`)));
    expect((await post(priya.cookie, url, { slots: four })).status).toBe(400);
    expect((await post(priya.cookie, url, { slots: [] })).status).toBe(400);
    expect((await post(priya.cookie, url, {})).status).toBe(400);
    for (const over of [
      { durationMinutes: 50 },
      { mode: "PHONE" },
      { note: "x".repeat(201) },
    ]) {
      expect(
        (await post(priya.cookie, url, { slots: [slot(ist("10:00"), over)] }))
          .status,
      ).toBe(400);
    }
    const twice = await post(priya.cookie, url, {
      slots: [slot(ist("10:00")), slot(ist("10:00"))],
    });
    expect(twice.status).toBe(400);
    expect(twice.body.fields["slots.1.startsAt"]).toBe(
      "Each time must be different",
    );
    expect(await stageOf(application.id)).toBe("SUBMITTED");
    expect(
      (
        await post(priya.cookie, url, {
          slots: [10, 11, 12].map((h) => slot(ist(`${h}:00`))),
        })
      ).status,
    ).toBe(201);
  });
});

describe("another client", () => {
  it("gets 404 on every portal action and nothing changes", async () => {
    const { application } = await submitted();
    const url = `/api/portal/applications/${application.id}`;
    const body = {
      "/shortlist": {},
      "/reject": { reason: "SKILLS_GAP" },
      "/slots": { slots: [slot(ist("10:00"))] },
    };
    for (const [path, json] of Object.entries(body)) {
      expect((await post(arjun.cookie, `${url}${path}`, json)).status).toBe(
        404,
      );
    }
    expect(await stageOf(application.id)).toBe("SUBMITTED");
    expect(await prisma.interviewSlot.count()).toBe(0);
  });

  it("cannot act on a candidate that was never submitted", async () => {
    const { application } = await candidateAt(
      sahyadriReq,
      recruiter.user.id,
      "SCREENED",
    );
    expect(
      (
        await post(
          arjun.cookie,
          `/api/portal/applications/${application.id}/shortlist`,
        )
      ).status,
    ).toBe(404);
  });
});

describe("who may use the client actions", () => {
  it("refuses a recruiter and the delivery head", async () => {
    const { application } = await submitted();
    const url = `/api/portal/applications/${application.id}`;
    for (const cookie of [recruiter.cookie, head.cookie]) {
      for (const path of ["/shortlist", "/reject", "/slots"]) {
        expect(
          (await post(cookie, `${url}${path}`, { reason: "SKILLS_GAP" }))
            .status,
        ).toBe(403);
      }
    }
    expect(await stageOf(application.id)).toBe("SUBMITTED");
  });
});
