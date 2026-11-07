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
let kestrel: Awaited<ReturnType<typeof createClient>>;
let requisitionId: string;

const NOTE =
  "Six years on Spring Boot services and a payments migration. Can join in a month.";

beforeEach(async () => {
  await resetDb();
  recruiter = await createStaff("RECRUITER", "ananya@example.test");
  head = await createStaff("DELIVERY_HEAD", "vikram@example.test");
  kestrel = await createClient("Kestrel", "priya@example.test");
  requisitionId = (await openRequisition(kestrel.client.id, recruiter.user.id))
    .id;
});

describe("submitting to the client", () => {
  it("moves a screened candidate to submitted and records who, when and why", async () => {
    const { application } = await candidateAt(
      requisitionId,
      recruiter.user.id,
      "SCREENED",
    );
    await prisma.application.update({
      where: { id: application.id },
      data: { submittedAt: null, submittedById: null, submissionNote: null },
    });
    const res = await post(
      recruiter.cookie,
      `/api/applications/${application.id}/submit`,
      { note: `  ${NOTE}  ` },
    );
    expect(res.status).toBe(200);
    const row = await prisma.application.findUniqueOrThrow({
      where: { id: application.id },
    });
    expect(row).toMatchObject({
      stage: "SUBMITTED",
      submittedById: recruiter.user.id,
      submissionNote: NOTE,
    });
    expect(row.submittedAt).toBeInstanceOf(Date);
    const event = await prisma.auditEvent.findFirstOrThrow({
      where: { action: "APPLICATION_SUBMITTED", entityId: application.id },
    });
    expect(event).toMatchObject({
      actorId: recruiter.user.id,
      meta: { band: "STRONG", noteLength: NOTE.length },
    });
  });

  it.each(["SOURCED", "SUBMITTED", "CLIENT_SHORTLISTED", "REJECTED"] as const)(
    "refuses a candidate who is %s",
    async (stage) => {
      const { application } = await candidateAt(
        requisitionId,
        recruiter.user.id,
        stage,
      );
      const res = await post(
        recruiter.cookie,
        `/api/applications/${application.id}/submit`,
        { note: NOTE },
      );
      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/screened/);
    },
  );

  it("needs a note of 20 to 600 characters", async () => {
    const { application } = await candidateAt(
      requisitionId,
      recruiter.user.id,
      "SCREENED",
    );
    const url = `/api/applications/${application.id}/submit`;
    const short = await post(recruiter.cookie, url, { note: "Good fit." });
    expect(short.status).toBe(400);
    expect(short.body.fields.note).toMatch(/at least 20/);
    const long = await post(recruiter.cookie, url, { note: "x".repeat(601) });
    expect(long.status).toBe(400);
    expect(long.body.fields.note).toMatch(/under 600/);
    expect((await post(recruiter.cookie, url, {})).status).toBe(400);
    expect(
      (await post(recruiter.cookie, url, { note: "x".repeat(600) })).status,
    ).toBe(200);
  });

  it("is for recruiters only", async () => {
    const { application } = await candidateAt(
      requisitionId,
      recruiter.user.id,
      "SCREENED",
    );
    const url = `/api/applications/${application.id}/submit`;
    expect((await post(head.cookie, url, { note: NOTE })).status).toBe(403);
    expect((await post(kestrel.cookie, url, { note: NOTE })).status).toBe(403);
    expect(
      (
        await post(recruiter.cookie, "/api/applications/nope/submit", {
          note: NOTE,
        })
      ).status,
    ).toBe(404);
  });
});

describe("withdrawing a submission", () => {
  it("works before the client acts and is audited", async () => {
    const { application } = await candidateAt(
      requisitionId,
      recruiter.user.id,
      "SUBMITTED",
    );
    const res = await post(
      recruiter.cookie,
      `/api/applications/${application.id}/withdraw`,
    );
    expect(res.status).toBe(200);
    expect(
      (
        await prisma.application.findUniqueOrThrow({
          where: { id: application.id },
        })
      ).stage,
    ).toBe("WITHDRAWN");
    expect(
      await prisma.auditEvent.count({
        where: { action: "SUBMISSION_WITHDRAWN", entityId: application.id },
      }),
    ).toBe(1);
  });

  it.each(["CLIENT_SHORTLISTED", "REJECTED", "SCREENED"] as const)(
    "is refused once the candidate is %s",
    async (stage) => {
      const { application } = await candidateAt(
        requisitionId,
        recruiter.user.id,
        stage,
      );
      const res = await post(
        recruiter.cookie,
        `/api/applications/${application.id}/withdraw`,
      );
      expect(res.status).toBe(409);
    },
  );

  it("cannot be done by the delivery head", async () => {
    const { application } = await candidateAt(
      requisitionId,
      recruiter.user.id,
      "SUBMITTED",
    );
    expect(
      (await post(head.cookie, `/api/applications/${application.id}/withdraw`))
        .status,
    ).toBe(403);
  });
});
