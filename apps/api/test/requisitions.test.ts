import { EOL } from "node:os";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RequisitionDetail } from "@hireproof/shared";
import { aiConfig, chat } from "../src/ai/llm";
import { app } from "../src/app";
import { prisma } from "../src/db";
import { loginAs, resetDb } from "./helpers";
import { JD, VALID } from "./jdFixture";
import { sample } from "./samples";

vi.mock("../src/ai/llm", async (original) => ({
  ...(await original<typeof import("../src/ai/llm")>()),
  aiConfig: vi.fn(),
  chat: vi.fn(),
}));

beforeEach(async () => {
  vi.resetAllMocks();
  vi.mocked(aiConfig).mockReturnValue(null);
  await resetDb();
});

const post = (cookie: string) =>
  request(app)
    .post("/api/requisitions")
    .set("Cookie", cookie)
    .set("X-Requested-With", "hireproof");

const put = (cookie: string, id: string, body: object) =>
  request(app)
    .put(`/api/requisitions/${id}/scorecard`)
    .set("Cookie", cookie)
    .send(body);

async function setup() {
  const recruiter = await loginAs("RECRUITER");
  const client = await prisma.client.create({
    data: { name: "Kestrel Infotech", industry: "IT_SERVICES" },
  });
  return { ...recruiter, client };
}

async function create(cookie: string, clientId: string, jdText = JD) {
  const res = await post(cookie)
    .field("clientId", clientId)
    .field("jdText", jdText);
  expect(res.status).toBe(201);
  return res.body as RequisitionDetail;
}

const editorBody = (req: RequisitionDetail, confirm = false) => ({
  criteria: req.scorecard!.criteria.map(({ id, kind, label }) => ({
    id,
    kind,
    label,
    reviewed: confirm,
  })),
  experience: {
    minYears: req.scorecard!.experience.minYears,
    maxYears: req.scorecard!.experience.maxYears,
  },
  notice: { maxDays: req.scorecard!.notice.maxDays },
  ctc: { maxLpa: req.scorecard!.ctc.maxLpa },
  locations: req.scorecard!.locations.values,
  reviewed: confirm
    ? { experience: true, notice: true, ctc: true, locations: true }
    : undefined,
  confirm,
});

const confirmable = (req: RequisitionDetail) => ({
  ...editorBody(req, true),
  criteria: [{ kind: "MUST_HAVE", label: "Java" }],
});

describe("creating a requisition", () => {
  it("extracts from pasted text with the AI and records the run", async () => {
    vi.mocked(aiConfig).mockReturnValue({ model: "test-model" });
    vi.mocked(chat).mockResolvedValueOnce({
      content: JSON.stringify(VALID),
      inputTokens: 90,
      outputTokens: 40,
    });
    const { cookie, client, user } = await setup();
    const req = await create(cookie, client.id);

    expect(req).toMatchObject({
      number: expect.any(Number),
      title: "Senior Java Developer",
      status: "DRAFT",
      owner: { id: user.id },
      client: { name: "Kestrel Infotech" },
      extraction: { outcome: "OK", model: "test-model" },
    });
    expect(req.scorecard).toMatchObject({
      source: "AI",
      model: "test-model",
      status: "DRAFT",
      version: 0,
    });
    expect(req.scorecard!.criteria).toHaveLength(3);

    const run = await prisma.aiRun.findFirstOrThrow();
    expect(run).toMatchObject({
      kind: "JD_EXTRACT",
      requisitionId: req.id,
      inputTokens: 90,
      outputTokens: 40,
    });
    const actions = (await prisma.auditEvent.findMany()).map((e) => e.action);
    expect(actions).toEqual(
      expect.arrayContaining(["REQUISITION_CREATED", "SCORECARD_EXTRACTED"]),
    );
  });

  it("keeps a given title and uses the rules when AI is off", async () => {
    const { cookie, client } = await setup();
    const res = await post(cookie)
      .field("clientId", client.id)
      .field("title", "Java lead")
      .field("jdText", JD);
    expect(res.body).toMatchObject({
      title: "Java lead",
      extraction: { outcome: "NOT_CONFIGURED" },
      scorecard: { source: "RULES" },
    });
  });

  describe("title when none is typed and the AI gives none", () => {
    const titleOf = async (jd: string, fileName?: string) => {
      const { cookie, client } = await setup();
      const req = post(cookie).field("clientId", client.id);
      const res = fileName
        ? await req.attach("jdFile", Buffer.from(jd), fileName)
        : await req.field("jdText", jd);
      expect(res.status).toBe(201);
      return res.body.title;
    };
    const body = "Must have Java and Spring Boot. Notice up to 60 days.";

    it("uses a short first line", async () => {
      expect(await titleOf(JD)).toBe("Senior Java Developer");
    });

    it("skips greetings and email headers", async () => {
      const jd = [
        "From: HR <hr@example.com>",
        "to: Hiring Desk",
        "Subject: FW: urgent",
        "",
        "Hi team,",
        "Dear all",
        "Store Operations Manager",
        body,
      ].join(EOL);
      expect(await titleOf(jd)).toBe("Store Operations Manager");
    });

    it("falls back to the file name when the first line is long", async () => {
      const long = "We urgently need someone to run two stores. " + body;
      expect(await titleOf(long, "Store ops JD.v2.txt")).toBe(
        "Store ops JD.v2",
      );
    });

    it("falls back to Untitled for pasted text with a long first line", async () => {
      const long = "We urgently need someone to run two stores. " + body;
      expect(await titleOf(long)).toBe("Untitled requisition");
    });
  });

  it("extracts from an uploaded docx", async () => {
    const { cookie, client } = await setup();
    const res = await post(cookie)
      .field("clientId", client.id)
      .attach(
        "jdFile",
        sample("jds/Kestrel_Senior_Java_Developer_JD.docx"),
        "Kestrel_Senior_Java_Developer_JD.docx",
      );
    expect(res.status).toBe(201);
    expect(res.body.jdFileName).toBe("Kestrel_Senior_Java_Developer_JD.docx");
    expect(res.body.jdText).toMatch(/Spring Boot/);
    expect(res.body.scorecard.experience.minYears).toBe(5);
  });

  it("rejects an unsupported file with a field error", async () => {
    const { cookie, client } = await setup();
    const res = await post(cookie)
      .field("clientId", client.id)
      .attach("jdFile", sample("edge/Resume_Gaurav_Sethi.odt"), "cv.odt");
    expect(res.status).toBe(400);
    expect(res.body.fields.jdFile).toMatch(/\.pdf, \.docx or \.txt/);
    expect(await prisma.requisition.count()).toBe(0);
  });

  it("rejects bad input with field errors", async () => {
    const { cookie, client } = await setup();
    const noClient = await post(cookie).field("jdText", JD);
    expect(noClient.status).toBe(400);
    expect(noClient.body.fields.clientId).toBeDefined();

    const unknownClient = await post(cookie)
      .field("clientId", "nope")
      .field("jdText", JD);
    expect(unknownClient.body.fields.clientId).toBeDefined();

    const noText = await post(cookie).field("clientId", client.id);
    expect(noText.body.fields.jdText).toBeDefined();

    const both = await post(cookie)
      .field("clientId", client.id)
      .field("jdText", JD)
      .attach("jdFile", Buffer.from("Some text file"), "jd.txt");
    expect(both.body.fields.jdText).toMatch(/not both/);
  });

  it("refuses multipart without the upload header", async () => {
    const { cookie, client } = await setup();
    const res = await request(app)
      .post("/api/requisitions")
      .set("Cookie", cookie)
      .field("clientId", client.id)
      .field("jdText", JD);
    expect(res.status).toBe(415);
  });
});

describe("access", () => {
  it("is 401 without a session", async () => {
    expect((await request(app).get("/api/requisitions")).status).toBe(401);
  });

  it("is 403 for a client hiring manager on every route", async () => {
    const { client, cookie: recruiter } = await setup();
    const req = await create(recruiter, client.id);
    const { cookie } = await loginAs("CLIENT_HM");
    const statuses = await Promise.all([
      request(app).get("/api/requisitions").set("Cookie", cookie),
      request(app).get(`/api/requisitions/${req.id}`).set("Cookie", cookie),
      post(cookie).field("clientId", client.id).field("jdText", JD),
      put(cookie, req.id, editorBody(req)),
      request(app)
        .patch(`/api/requisitions/${req.id}`)
        .set("Cookie", cookie)
        .send({ status: "CLOSED" }),
      request(app)
        .post(`/api/requisitions/${req.id}/scorecard/extract`)
        .set("Cookie", cookie)
        .send({}),
    ]);
    expect(statuses.map((r) => r.status)).toEqual([
      403, 403, 403, 403, 403, 403,
    ]);
  });

  it("lets the delivery head read but not change anything", async () => {
    const { client, cookie: recruiter } = await setup();
    const req = await create(recruiter, client.id);
    const { cookie } = await loginAs("DELIVERY_HEAD");

    const list = await request(app)
      .get("/api/requisitions")
      .set("Cookie", cookie);
    expect(list.body).toHaveLength(1);
    const one = await request(app)
      .get(`/api/requisitions/${req.id}`)
      .set("Cookie", cookie);
    expect(one.status).toBe(200);

    const writes = await Promise.all([
      post(cookie).field("clientId", client.id).field("jdText", JD),
      put(cookie, req.id, editorBody(req)),
      request(app)
        .patch(`/api/requisitions/${req.id}`)
        .set("Cookie", cookie)
        .send({ title: "x" }),
      request(app)
        .post(`/api/requisitions/${req.id}/scorecard/extract`)
        .set("Cookie", cookie)
        .send({}),
    ]);
    expect(writes.map((r) => r.status)).toEqual([403, 403, 403, 403]);
  });

  it("is 404 for an unknown id", async () => {
    const { cookie } = await setup();
    const res = await request(app)
      .get("/api/requisitions/missing")
      .set("Cookie", cookie);
    expect(res.status).toBe(404);
  });
});

describe("listing", () => {
  it("filters by status, client and owner", async () => {
    const { cookie, client } = await setup();
    const other = await prisma.client.create({
      data: { name: "Marigold Retail", industry: "RETAIL" },
    });
    const a = await create(cookie, client.id);
    await create(cookie, other.id);
    await put(cookie, a.id, confirmable(a));

    const list = (q: string) =>
      request(app).get(`/api/requisitions?${q}`).set("Cookie", cookie);
    expect((await list("")).body).toHaveLength(2);
    const open = await list("status=OPEN");
    expect(open.body.map((r: { id: string }) => r.id)).toEqual([a.id]);
    expect((await list(`clientId=${other.id}`)).body).toHaveLength(1);
    expect((await list("mine=true")).body).toHaveLength(2);
    expect((await list("status=BOGUS")).status).toBe(400);

    const rohan = await prisma.user.create({
      data: {
        email: "rohan@example.test",
        name: "Rohan",
        role: "RECRUITER",
        passwordHash: "x",
      },
    });
    await prisma.requisition.updateMany({ data: { ownerId: rohan.id } });
    expect((await list("mine=true")).body).toHaveLength(0);
    expect((await list("")).body[0]).toMatchObject({
      scorecardStatus: expect.any(String),
      criteriaCount: expect.any(Number),
      owner: { name: "Rohan" },
    });
  });
});

describe("scorecard review", () => {
  it("confirms: DRAFT to OPEN, version bumped, audited", async () => {
    const { cookie, client, user } = await setup();
    const req = await create(cookie, client.id);

    const first = await put(cookie, req.id, confirmable(req));
    expect(first.status).toBe(200);
    expect(first.body.status).toBe("OPEN");
    expect(first.body.scorecard).toMatchObject({
      status: "CONFIRMED",
      version: 1,
    });
    const row = await prisma.scorecard.findFirstOrThrow();
    expect(row.confirmedById).toBe(user.id);

    // The same criteria and ranges again change nothing.
    const same = await put(cookie, req.id, confirmable(req));
    expect(same.body.scorecard.version).toBe(1);
    const changed = await put(cookie, req.id, {
      ...confirmable(req),
      criteria: [
        { kind: "MUST_HAVE", label: "Java" },
        { kind: "NICE_TO_HAVE", label: "Kafka" },
      ],
    });
    expect(changed.body.scorecard.version).toBe(2);
    const events = await prisma.auditEvent.findMany({
      where: { action: "SCORECARD_CONFIRMED" },
      orderBy: { createdAt: "asc" },
    });
    expect(events.map((e) => e.meta)).toEqual([{ version: 1 }, { version: 2 }]);
  });

  it("returns a confirmed scorecard to draft when it is edited", async () => {
    const { cookie, client } = await setup();
    const req = await create(cookie, client.id);
    const confirmed = await put(cookie, req.id, confirmable(req));
    const edited = await put(cookie, req.id, {
      ...editorBody(confirmed.body),
      notice: { maxDays: 45 },
    });
    expect(edited.body.scorecard).toMatchObject({
      status: "DRAFT",
      version: 1,
    });
    expect(edited.body.status).toBe("OPEN");
  });

  it("clears review flags on edited fields and adds no quote to new items", async () => {
    const { cookie, client } = await setup();
    const req = await create(
      cookie,
      client.id,
      "Looking for a Java dev. 3 to 5 years. Notice: 30 days.",
    );
    const java = req.scorecard!.criteria.find((c) => c.label === "Java")!;
    expect(java.needsReview).toBe(true);
    expect(req.scorecard!.notice.needsReview).toBe(true);

    const res = await put(cookie, req.id, {
      ...editorBody(req),
      criteria: [
        { id: java.id, kind: java.kind, label: "Java" },
        { kind: "NICE_TO_HAVE", label: "Docker" },
      ],
      notice: { maxDays: 45 },
    });
    const { criteria, notice, experience } = res.body.scorecard;
    expect(criteria[0]).toMatchObject({ id: java.id, needsReview: true });
    expect(criteria[1]).toMatchObject({
      sourceQuote: null,
      needsReview: false,
    });
    expect(notice).toMatchObject({ maxDays: 45, needsReview: false });
    expect(experience.needsReview).toBe(true);

    const renamed = await put(cookie, req.id, {
      ...editorBody(res.body),
      criteria: [{ id: criteria[0].id, kind: "MUST_HAVE", label: "Java" }],
    });
    expect(renamed.body.scorecard.criteria[0]).toMatchObject({
      needsReview: false,
    });
    expect(renamed.body.scorecard.criteria[0].sourceQuote).toBeTruthy();
  });

  it("validates before confirming", async () => {
    const { cookie, client } = await setup();
    const req = await create(cookie, client.id);

    const noMust = await put(cookie, req.id, {
      ...editorBody(req, true),
      criteria: [{ kind: "NICE_TO_HAVE", label: "Kafka" }],
    });
    expect(noMust.status).toBe(400);
    expect(noMust.body.fields.criteria).toMatch(/must-have/);

    const reversed = await put(cookie, req.id, {
      ...editorBody(req),
      experience: { minYears: 9, maxYears: 3 },
    });
    expect(reversed.status).toBe(400);
    expect(reversed.body.fields["experience.maxYears"]).toBeDefined();

    const absurd = await put(cookie, req.id, {
      ...editorBody(req),
      ctc: { maxLpa: 5000 },
    });
    expect(absurd.status).toBe(400);
  });

  it("re-extracts a draft, but a confirmed one needs force", async () => {
    const { cookie, client } = await setup();
    const req = await create(cookie, client.id);
    const extract = (body: object) =>
      request(app)
        .post(`/api/requisitions/${req.id}/scorecard/extract`)
        .set("Cookie", cookie)
        .send(body);

    expect((await extract({})).status).toBe(200);
    expect(await prisma.aiRun.count()).toBe(2);

    await put(cookie, req.id, confirmable(req));
    expect((await extract({})).status).toBe(409);
    const forced = await extract({ force: true });
    expect(forced.status).toBe(200);
    expect(forced.body.scorecard.status).toBe("DRAFT");
  });
});

describe("review before confirming", () => {
  it("refuses to confirm while items are still flagged", async () => {
    const { cookie, client } = await setup();
    const req = await create(cookie, client.id);
    const body = {
      ...editorBody(req),
      criteria: req.scorecard!.criteria.map(({ id, label }) => ({
        id,
        kind: "MUST_HAVE",
        label,
      })),
      confirm: true,
    };
    const res = await put(cookie, req.id, body);
    expect(res.status).toBe(422);
    expect(res.body.pending).toEqual(
      expect.arrayContaining(["Experience", "Notice period", "CTC budget"]),
    );
    expect(
      await prisma.scorecard.count({ where: { status: "CONFIRMED" } }),
    ).toBe(0);
  });

  it("clears a flag when it is marked reviewed without editing", async () => {
    const { cookie, client } = await setup();
    const req = await create(cookie, client.id);
    const java = req.scorecard!.criteria.find((c) => c.label === "Java")!;
    expect(java.needsReview).toBe(true);

    const res = await put(cookie, req.id, {
      ...editorBody(req),
      criteria: req.scorecard!.criteria.map(({ id, kind, label }) => ({
        id,
        kind,
        label,
        reviewed: id === java.id,
      })),
      reviewed: { notice: true },
    });
    const card = res.body.scorecard;
    expect(
      card.criteria.find((c: { id: string }) => c.id === java.id),
    ).toMatchObject({
      needsReview: false,
      sourceQuote: expect.any(String),
    });
    expect(card.notice.needsReview).toBe(false);
    expect(card.experience.needsReview).toBe(true);
  });
});

describe("PATCH /api/requisitions/:id", () => {
  it("changes status and title and audits the status change", async () => {
    const { cookie, client } = await setup();
    const req = await create(cookie, client.id);
    const patch = (body: object) =>
      request(app)
        .patch(`/api/requisitions/${req.id}`)
        .set("Cookie", cookie)
        .send(body);

    expect((await patch({ status: "OPEN" })).status).toBe(409);
    expect((await patch({ status: "DRAFT" })).status).toBe(400);
    expect((await patch({})).status).toBe(400);

    const closed = await patch({ status: "CLOSED", title: "Renamed" });
    expect(closed.body).toMatchObject({ status: "CLOSED", title: "Renamed" });
    const event = await prisma.auditEvent.findFirstOrThrow({
      where: { action: "REQUISITION_STATUS_CHANGED" },
    });
    expect(event.meta).toEqual({ from: "DRAFT", to: "CLOSED" });
  });
});
