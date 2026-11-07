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
let requisitionId: string;

beforeEach(async () => {
  await resetDb();
  recruiter = await createStaff("RECRUITER", "ananya@example.test");
  head = await createStaff("DELIVERY_HEAD", "vikram@example.test");
  priya = await createClient("Kestrel", "priya@example.test");
  requisitionId = (await openRequisition(priya.client.id, recruiter.user.id))
    .id;
});

const stageOf = async (id: string) =>
  (await prisma.application.findUniqueOrThrow({ where: { id } })).stage;

async function withSlots(count = 3) {
  const { application } = await candidateAt(
    requisitionId,
    recruiter.user.id,
    "CLIENT_SHORTLISTED",
  );
  const slots = [];
  for (let i = 0; i < count; i++) {
    slots.push(
      await prisma.interviewSlot.create({
        data: {
          applicationId: application.id,
          startsAt: new Date(Date.UTC(2031, 0, 6 + i, 5, 0)),
          durationMinutes: 45,
          mode: i === 0 ? "VIDEO" : "IN_PERSON",
          note: i === 0 ? "Meet the team lead" : null,
          proposedById: priya.user.id,
        },
      }),
    );
  }
  return { application, slots };
}

describe("confirming a proposed time", () => {
  it("books the interview, declines the others and records one mocked message", async () => {
    const { application, slots } = await withSlots();
    const res = await post(
      recruiter.cookie,
      `/api/slots/${slots[1].id}/confirm`,
    );
    expect(res.status).toBe(200);
    expect(res.body.message).toMatchObject({
      recipient: "CANDIDATE",
      subject: "Interview for Senior Java Developer at Kestrel",
    });
    expect(res.body.message.body).toContain("Hello Riya,");
    expect(res.body.message.body).toContain("In person");
    expect(res.body.message.body).toContain("IST");

    expect(await stageOf(application.id)).toBe("INTERVIEW");
    const rows = await prisma.interviewSlot.findMany({
      where: { applicationId: application.id },
      orderBy: { startsAt: "asc" },
    });
    expect(rows.map((s) => s.status)).toEqual([
      "DECLINED",
      "CONFIRMED",
      "DECLINED",
    ]);
    const messages = await prisma.outboundMessage.findMany();
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      applicationId: application.id,
      recipient: "CANDIDATE",
      channel: "EMAIL",
      status: "MOCKED",
      createdById: recruiter.user.id,
    });
    const actions = (
      await prisma.auditEvent.findMany({
        where: { entityId: application.id },
        orderBy: { createdAt: "asc" },
      })
    ).map((e) => e.action);
    expect(actions).toEqual([
      "SLOT_CONFIRMED",
      "STAGE_CHANGED",
      "MESSAGE_RECORDED",
    ]);
  });

  it("cannot be done twice", async () => {
    const { slots } = await withSlots(2);
    await post(recruiter.cookie, `/api/slots/${slots[0].id}/confirm`);
    expect(
      (await post(recruiter.cookie, `/api/slots/${slots[0].id}/confirm`))
        .status,
    ).toBe(409);
    expect(
      (await post(recruiter.cookie, `/api/slots/${slots[1].id}/confirm`))
        .status,
    ).toBe(409);
    expect(await prisma.outboundMessage.count()).toBe(1);
  });

  it("is refused when the candidate is not shortlisted", async () => {
    const { application, slots } = await withSlots(1);
    await prisma.application.update({
      where: { id: application.id },
      data: { stage: "REJECTED" },
    });
    expect(
      (await post(recruiter.cookie, `/api/slots/${slots[0].id}/confirm`))
        .status,
    ).toBe(409);
    expect(await prisma.outboundMessage.count()).toBe(0);
  });

  it("is for recruiters only, and a missing time is 404", async () => {
    const { slots } = await withSlots(1);
    for (const cookie of [head.cookie, priya.cookie]) {
      expect(
        (await post(cookie, `/api/slots/${slots[0].id}/confirm`)).status,
      ).toBe(403);
    }
    expect(
      (await post(recruiter.cookie, "/api/slots/nope/confirm")).status,
    ).toBe(404);
  });
});

describe("none of the times work", () => {
  it("declines every proposal, keeps the stage and records a message to the client", async () => {
    const { application } = await withSlots();
    const res = await post(
      recruiter.cookie,
      `/api/applications/${application.id}/slots/decline`,
    );
    expect(res.status).toBe(200);
    expect(res.body.message.recipient).toBe("CLIENT");
    expect(await stageOf(application.id)).toBe("CLIENT_SHORTLISTED");
    expect(
      (await prisma.interviewSlot.findMany()).every(
        (s) => s.status === "DECLINED",
      ),
    ).toBe(true);
    expect(await prisma.outboundMessage.findMany()).toMatchObject([
      { recipient: "CLIENT", status: "MOCKED" },
    ]);
    // The client can propose again.
    expect(
      (
        await post(
          recruiter.cookie,
          `/api/applications/${application.id}/slots/decline`,
        )
      ).status,
    ).toBe(409);
  });

  it("is refused for the delivery head and the client", async () => {
    const { application } = await withSlots(1);
    for (const cookie of [head.cookie, priya.cookie]) {
      expect(
        (
          await post(
            cookie,
            `/api/applications/${application.id}/slots/decline`,
          )
        ).status,
      ).toBe(403);
    }
  });
});

describe("moving a candidate after the interview", () => {
  async function at(stage: "INTERVIEW" | "OFFERED") {
    return (await candidateAt(requisitionId, recruiter.user.id, stage))
      .application.id;
  }
  const move = (id: string, to: string, cookie = recruiter.cookie) =>
    post(cookie, `/api/applications/${id}/move`, { to });

  it("takes interview to offered to joined and audits each move", async () => {
    const id = await at("INTERVIEW");
    expect((await move(id, "OFFERED")).status).toBe(200);
    expect(await stageOf(id)).toBe("OFFERED");
    expect((await move(id, "JOINED")).status).toBe(200);
    expect(await stageOf(id)).toBe("JOINED");
    const events = await prisma.auditEvent.findMany({
      where: { action: "STAGE_CHANGED", entityId: id },
      orderBy: { createdAt: "asc" },
    });
    expect(events.map((e) => e.meta)).toMatchObject([
      { from: "INTERVIEW", to: "OFFERED" },
      { from: "OFFERED", to: "JOINED" },
    ]);
  });

  it("lets an interview end in a rejection by the recruiter", async () => {
    const id = await at("INTERVIEW");
    expect((await move(id, "REJECTED")).status).toBe(200);
    expect(
      await prisma.application.findUniqueOrThrow({ where: { id } }),
    ).toMatchObject({
      stage: "REJECTED",
      rejectedBy: "RECRUITER",
      decidedById: recruiter.user.id,
    });
  });

  it("lets an offer fall through as withdrawn", async () => {
    const id = await at("OFFERED");
    expect((await move(id, "WITHDRAWN")).status).toBe(200);
    expect(await stageOf(id)).toBe("WITHDRAWN");
  });

  it.each([
    ["INTERVIEW", "JOINED"],
    ["INTERVIEW", "WITHDRAWN"],
    ["OFFERED", "REJECTED"],
    ["OFFERED", "OFFERED"],
  ] as const)(
    "refuses %s to %s with 409 and a plain message",
    async (from, to) => {
      const id = await at(from);
      const res = await move(id, to);
      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/cannot be moved to/);
      expect(await stageOf(id)).toBe(from);
    },
  );

  it("refuses a candidate who is not at interview or offer", async () => {
    for (const stage of [
      "SOURCED",
      "SCREENED",
      "SUBMITTED",
      "CLIENT_SHORTLISTED",
      "JOINED",
    ] as const) {
      const { application } = await candidateAt(
        requisitionId,
        recruiter.user.id,
        stage,
        `P ${stage}`,
      );
      expect((await move(application.id, "OFFERED")).status, stage).toBe(409);
      expect((await move(application.id, "REJECTED")).status, stage).toBe(409);
    }
  });

  it("rejects a target outside the pipeline", async () => {
    const id = await at("INTERVIEW");
    expect((await move(id, "SOURCED")).status).toBe(400);
    expect((await move(id, "nonsense")).status).toBe(400);
    expect(
      (await post(recruiter.cookie, `/api/applications/${id}/move`, {})).status,
    ).toBe(400);
  });

  it("is for recruiters only", async () => {
    const id = await at("INTERVIEW");
    expect((await move(id, "OFFERED", head.cookie)).status).toBe(403);
    expect((await move(id, "OFFERED", priya.cookie)).status).toBe(403);
    expect((await move("nope", "OFFERED")).status).toBe(404);
    expect(await stageOf(id)).toBe("INTERVIEW");
  });
});

describe("the delivery head reads and changes nothing", () => {
  it("gets 403 on every recruiter POST", async () => {
    const { application } = await candidateAt(
      requisitionId,
      recruiter.user.id,
      "SCREENED",
    );
    const paths = [
      "screen",
      "reject",
      "reopen",
      "rescore",
      "submit",
      "withdraw",
      "move",
      "slots/decline",
    ];
    for (const path of paths) {
      const res = await post(
        head.cookie,
        `/api/applications/${application.id}/${path}`,
        {
          note: "A long enough note about the candidate.",
          reason: "SKILLS_GAP",
          to: "OFFERED",
        },
      );
      expect(res.status, path).toBe(403);
    }
    expect((await post(head.cookie, "/api/slots/x/confirm")).status).toBe(403);
    expect(await stageOf(application.id)).toBe("SCREENED");
  });
});
