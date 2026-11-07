import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CandidateDetail,
  CandidateList,
  PendingDuplicate,
  UploadBatchView,
} from "@hireproof/shared";
import { app } from "../src/app";
import { prisma } from "../src/db";
import { setScoreSender } from "../src/score/trigger";
import { sample } from "./samples";
import { addCv, createRequisition, deps, okReply, run } from "./cvHelpers";
import { loginAs, resetDb } from "./helpers";

let recruiter: Awaited<ReturnType<typeof loginAs>>;
let requisitionId: string;

beforeEach(async () => {
  await resetDb();
  recruiter = await loginAs("RECRUITER");
  requisitionId = (await createRequisition(recruiter.user.id)).id;
});

const get = (cookie: string, path: string) =>
  request(app).get(path).set("Cookie", cookie);
const consent = { basis: true, source: "REFERRAL" } as const;
const postJson = (cookie: string, path: string, body: object = {}) =>
  request(app).post(path).set("Cookie", cookie).send(body);

async function newBatch(cookie = recruiter.cookie, expectedCount = 3) {
  const res = await postJson(
    cookie,
    `/api/requisitions/${requisitionId}/uploads`,
    { expectedCount, consent },
  );
  expect(res.status).toBe(201);
  return res.body.batchId as string;
}

const send = (
  batchId: string,
  files: { name: string; data: Buffer }[],
  cookie = recruiter.cookie,
) => {
  const req = request(app)
    .post(`/api/uploads/${batchId}/files`)
    .set("Cookie", cookie)
    .set("X-Requested-With", "hireproof");
  for (const f of files) req.attach("files", f.data, f.name);
  return req;
};

const pdf = (name = "Ritika_Bansal_Resume.pdf") => ({
  name,
  data: sample("cvs/Ritika_Bansal_Resume.pdf"),
});

describe("access", () => {
  const routes: [string, string][] = [
    ["get", "/api/uploads/x"],
    ["post", "/api/requisitions/x/uploads"],
    ["post", "/api/uploads/x/files"],
    ["get", "/api/requisitions/x/uploads/latest"],
    ["get", "/api/requisitions/x/candidates"],
    ["get", "/api/candidates/x"],
    ["get", "/api/duplicates?status=PENDING"],
    ["post", "/api/duplicates/x/resolve"],
    ["post", "/api/cvs/x/retry"],
  ];

  it.each(routes)(
    "a hiring manager gets 403 from %s %s",
    async (method, path) => {
      const hm = await loginAs("CLIENT_HM");
      const res = await request(app)
        [method as "get" | "post"](path)
        .set("Cookie", hm.cookie)
        .set("X-Requested-With", "hireproof")
        .send({});
      expect(res.status).toBe(403);
    },
  );

  it.each(routes)(
    "a visitor without a session gets 401 from %s %s",
    async (method, path) => {
      const res = await request(app)
        [method as "get" | "post"](path)
        .set("X-Requested-With", "hireproof")
        .send({});
      expect(res.status).toBe(401);
    },
  );

  it.each(routes.filter(([m]) => m === "post"))(
    "a delivery head gets 403 from %s %s",
    async (method, path) => {
      const head = await loginAs("DELIVERY_HEAD");
      const res = await request(app)
        [method as "post"](path)
        .set("Cookie", head.cookie)
        .set("X-Requested-With", "hireproof")
        .send({});
      expect(res.status).toBe(403);
    },
  );

  it("a delivery head can read uploads, candidates and duplicates", async () => {
    const head = await loginAs("DELIVERY_HEAD");
    const batchId = await newBatch();
    expect((await get(head.cookie, `/api/uploads/${batchId}`)).status).toBe(
      200,
    );
    expect(
      (await get(head.cookie, `/api/requisitions/${requisitionId}/candidates`))
        .status,
    ).toBe(200);
    expect((await get(head.cookie, "/api/duplicates")).status).toBe(200);
  });
});

describe("creating a batch", () => {
  it.each([0, 501, 1.5])("refuses %s files", async (expectedCount) => {
    const res = await postJson(
      recruiter.cookie,
      `/api/requisitions/${requisitionId}/uploads`,
      { expectedCount, consent },
    );
    expect(res.status).toBe(400);
  });

  it("accepts 500", async () => {
    expect(await newBatch(recruiter.cookie, 500)).toBeTruthy();
  });

  it("404s for an unknown requisition", async () => {
    const res = await postJson(
      recruiter.cookie,
      "/api/requisitions/nope/uploads",
      {
        expectedCount: 1,
        consent,
      },
    );
    expect(res.status).toBe(404);
  });
});

describe("consent", () => {
  const batchUrl = () => `/api/requisitions/${requisitionId}/uploads`;

  it.each([
    ["none given", { expectedCount: 1 }],
    [
      "basis not ticked",
      { expectedCount: 1, consent: { basis: false, source: "REFERRAL" } },
    ],
    ["no source", { expectedCount: 1, consent: { basis: true } }],
    [
      "other without a note",
      { expectedCount: 1, consent: { basis: true, source: "OTHER" } },
    ],
  ])("refuses a batch with %s", async (_name, body) => {
    const res = await postJson(recruiter.cookie, batchUrl(), body);
    expect(res.status).toBe(400);
    expect(res.body.error).toEqual(expect.any(String));
    expect(await prisma.uploadBatch.count()).toBe(0);
  });

  it("stores the attestation against every CV in the batch", async () => {
    const created = await postJson(recruiter.cookie, batchUrl(), {
      expectedCount: 2,
      consent: { basis: true, source: "OTHER", sourceNote: "College fair" },
    });
    const batchId = created.body.batchId as string;
    await send(batchId, [
      pdf(),
      { name: "Arjun_Rawat_CV.docx", data: sample("cvs/Arjun_Rawat_CV.docx") },
    ]);
    const records = await prisma.consentRecord.findMany();
    expect(records).toHaveLength(2);
    expect(new Set(records.map((r) => r.cvId)).size).toBe(2);
    for (const r of records) {
      expect(r).toMatchObject({
        basis: "APPLIED_OR_AGREED",
        source: "OTHER",
        sourceNote: "College fair",
        attestedById: recruiter.user.id,
        noticeVersion: "2026-11",
        candidateId: null,
      });
    }
    expect(
      await prisma.auditEvent.count({
        where: { action: "UPLOAD_CONSENT_RECORDED", entityId: batchId },
      }),
    ).toBe(1);
  });

  it("links the record to the candidate once the CV is read", async () => {
    const batchId = await newBatch();
    await send(batchId, [pdf()]);
    const [cv] = await prisma.cvDocument.findMany();
    await run(
      cv.id,
      deps(vi.fn().mockResolvedValue(okReply({ name: "Ritika Bansal" }))),
    );
    const candidate = await prisma.candidate.findFirstOrThrow();
    const profile = (
      await get(recruiter.cookie, `/api/candidates/${candidate.id}`)
    ).body as CandidateDetail;
    expect(profile.consents).toMatchObject([
      {
        fileName: "Ritika_Bansal_Resume.pdf",
        source: "REFERRAL",
        attestedBy: "Test User",
      },
    ]);
  });

  it("refuses files for a batch that has no consent on record", async () => {
    const batch = await prisma.uploadBatch.create({
      data: {
        requisitionId,
        uploadedById: recruiter.user.id,
        expectedCount: 1,
      },
    });
    const res = await send(batch.id, [pdf()]);
    expect(res.status).toBe(409);
    expect(await prisma.cvDocument.count()).toBe(0);
  });
});

describe("sending files", () => {
  it("queues valid files and stores the bytes with their hash", async () => {
    const batchId = await newBatch();
    const res = await send(batchId, [
      pdf(),
      { name: "Arjun_Rawat_CV.docx", data: sample("cvs/Arjun_Rawat_CV.docx") },
    ]);
    expect(res.status).toBe(201);
    expect(res.body.results).toMatchObject([
      { fileName: "Ritika_Bansal_Resume.pdf", accepted: true },
      { fileName: "Arjun_Rawat_CV.docx", accepted: true },
    ]);
    const rows = await prisma.cvDocument.findMany({
      orderBy: { fileName: "asc" },
    });
    expect(rows).toMatchObject(
      [
        { status: "QUEUED", mimeType: "application/pdf", requisitionId },
        { status: "QUEUED" },
      ].reverse(),
    );
    expect(rows[0].sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(Buffer.from(rows[1].data)).toEqual(
      sample("cvs/Ritika_Bansal_Resume.pdf"),
    );
  });

  it("rejects more than 10 files in one request", async () => {
    const batchId = await newBatch();
    const res = await send(
      batchId,
      Array.from({ length: 11 }, (_, i) => pdf(`cv${i}.pdf`)),
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/at most 10 files/);
    expect(await prisma.cvDocument.count()).toBe(0);
  });

  it("accepts exactly 10 files in one request", async () => {
    const batchId = await newBatch();
    const res = await send(
      batchId,
      Array.from({ length: 10 }, (_, i) => pdf(`cv${i}.pdf`)),
    );
    expect(res.status).toBe(201);
    expect(
      res.body.results.every((r: { accepted: boolean }) => r.accepted),
    ).toBe(true);
  });

  it("rejects an 11 MB file but keeps the others in the request", async () => {
    const batchId = await newBatch();
    const big = Buffer.concat([
      Buffer.from("%PDF-1.7\n"),
      Buffer.alloc(11 * 1024 * 1024),
    ]);
    const res = await send(batchId, [
      { name: "big.pdf", data: big },
      pdf("small.pdf"),
    ]);
    expect(res.status).toBe(201);
    expect(res.body.results).toMatchObject([
      {
        fileName: "big.pdf",
        accepted: false,
        reason: "This file is larger than 10 MB.",
      },
      { fileName: "small.pdf", accepted: true },
    ]);
    expect(await prisma.cvDocument.count()).toBe(1);
  });

  it("accepts a file just under the limit", async () => {
    const batchId = await newBatch();
    const data = Buffer.concat([
      Buffer.from("%PDF-1.7\n"),
      Buffer.alloc(10 * 1024 * 1024 - 100),
    ]);
    const res = await send(batchId, [{ name: "ok.pdf", data }]);
    expect(res.body.results[0].accepted).toBe(true);
  });

  it("rejects an unsupported type but accepts the others sent with it", async () => {
    const batchId = await newBatch();
    const res = await send(batchId, [
      {
        name: "Resume_Gaurav_Sethi.odt",
        data: sample("edge/Resume_Gaurav_Sethi.odt"),
      },
      pdf(),
      { name: "notes.txt", data: Buffer.from("plain text") },
    ]);
    expect(res.status).toBe(201);
    expect(res.body.results).toMatchObject([
      { accepted: false, reason: "Only PDF and DOCX files are accepted." },
      { accepted: true },
      { accepted: false, reason: "Only PDF and DOCX files are accepted." },
    ]);
    expect(await prisma.cvDocument.count()).toBe(1);
  });

  it("decides by the file's bytes, not its name", async () => {
    const batchId = await newBatch();
    const res = await send(batchId, [
      { name: "really-a-docx.pdf", data: sample("cvs/Arjun_Rawat_CV.docx") },
      { name: "script.pdf", data: Buffer.from("<script>alert(1)</script>") },
      { name: "empty.pdf", data: Buffer.alloc(0) },
    ]);
    expect(
      res.body.results.map((r: { accepted: boolean }) => r.accepted),
    ).toEqual([false, false, false]);
  });

  it("needs the multipart header, so a cross-site form cannot upload", async () => {
    const batchId = await newBatch();
    const res = await request(app)
      .post(`/api/uploads/${batchId}/files`)
      .set("Cookie", recruiter.cookie)
      .attach("files", pdf().data, "a.pdf");
    expect(res.status).toBe(415);
  });

  it("stops at 500 files in a batch", async () => {
    const batchId = await newBatch();
    await prisma.cvDocument.createMany({
      data: Array.from({ length: 499 }, (_, i) => ({
        batchId,
        requisitionId,
        fileName: `f${i}.pdf`,
        mimeType: "application/pdf",
        sizeBytes: 1,
        sha256: `h${i}`,
        data: new Uint8Array([1]),
      })),
    });
    const res = await send(batchId, [pdf("a.pdf"), pdf("b.pdf")]);
    expect(res.body.results).toMatchObject([
      { accepted: true },
      { accepted: false, reason: "This upload already has 500 files." },
    ]);
  });

  it("404s for an unknown batch", async () => {
    expect((await send("nope", [pdf()])).status).toBe(404);
  });
});

describe("batch status", () => {
  it("reports each file and counts by status", async () => {
    const batchId = await newBatch();
    await send(batchId, [pdf()]);
    const [cv] = await prisma.cvDocument.findMany();
    await run(
      cv.id,
      deps(vi.fn().mockResolvedValue(okReply({ name: "Ritika Bansal" }))),
    );

    const view = (await get(recruiter.cookie, `/api/uploads/${batchId}`))
      .body as UploadBatchView;
    expect(view.done).toBe(true);
    expect(view.counts).toEqual({ PARSED: 1 });
    expect(view.files[0]).toMatchObject({
      fileName: "Ritika_Bansal_Resume.pdf",
      status: "PARSED",
      candidate: { name: "Ritika Bansal" },
    });
    expect(view.files[0]).not.toHaveProperty("data");
    const latest = await get(
      recruiter.cookie,
      `/api/requisitions/${requisitionId}/uploads/latest`,
    );
    expect(latest.body.id).toBe(batchId);
  });

  it("is not done while a file is still queued", async () => {
    const batchId = await newBatch();
    await send(batchId, [pdf()]);
    const view = (await get(recruiter.cookie, `/api/uploads/${batchId}`))
      .body as UploadBatchView;
    expect(view).toMatchObject({ done: false, counts: { QUEUED: 1 } });
  });
});

describe("retry", () => {
  it("queues a failed CV again and clears the failure", async () => {
    const cv = await addCv(
      "edge/Vandana_Rawal_Resume.pdf",
      requisitionId,
      recruiter.user.id,
    );
    await run(cv.id, deps(vi.fn()));
    expect(
      (await prisma.cvDocument.findUniqueOrThrow({ where: { id: cv.id } }))
        .status,
    ).toBe("FAILED");

    const res = await postJson(recruiter.cookie, `/api/cvs/${cv.id}/retry`);
    expect(res.status).toBe(200);
    expect(
      await prisma.cvDocument.findUniqueOrThrow({ where: { id: cv.id } }),
    ).toMatchObject({
      status: "QUEUED",
      failureReason: null,
    });
  });

  it("refuses a CV that parsed cleanly", async () => {
    const cv = await addCv(
      "cvs/Ritika_Bansal_Resume.pdf",
      requisitionId,
      recruiter.user.id,
    );
    await run(
      cv.id,
      deps(
        vi.fn().mockResolvedValue(
          okReply({
            name: "Ritika Bansal",
            currentRole: "Senior Java Developer",
            location: "Noida",
          }),
        ),
      ),
    );
    const res = await postJson(recruiter.cookie, `/api/cvs/${cv.id}/retry`);
    expect(res.status).toBe(409);
  });

  it("removes a candidate that existed only for the CV being run again", async () => {
    const cv = await addCv(
      "cvs/Ritika_Bansal_Resume.pdf",
      requisitionId,
      recruiter.user.id,
    );
    await run(cv.id, deps(vi.fn(), null));
    expect(
      (await prisma.cvDocument.findUniqueOrThrow({ where: { id: cv.id } }))
        .status,
    ).toBe("NEEDS_REVIEW");
    expect(await prisma.candidate.count()).toBe(1);

    expect(
      (await postJson(recruiter.cookie, `/api/cvs/${cv.id}/retry`)).status,
    ).toBe(200);
    expect(await prisma.candidate.count()).toBe(0);
    expect(await prisma.application.count()).toBe(0);
  });
});

describe("candidates", () => {
  async function parsed(path: string, name: string, reqId = requisitionId) {
    const cv = await addCv(path, reqId, recruiter.user.id);
    await run(cv.id, deps(vi.fn().mockResolvedValue(okReply({ name }))));
    return prisma.cvDocument.findUniqueOrThrow({ where: { id: cv.id } });
  }

  it("lists a requisition's candidates, searchable by name and skill", async () => {
    await parsed("cvs/Ritika_Bansal_Resume.pdf", "Ritika Bansal");
    await parsed("cvs/Arjun_Rawat_CV.docx", "Arjun Rawat");

    const all = (
      await get(
        recruiter.cookie,
        `/api/requisitions/${requisitionId}/candidates`,
      )
    ).body as CandidateList;
    expect(all.total).toBe(2);
    expect(all.items[0]).toMatchObject({ stage: "SOURCED", scanned: false });

    const byName = (
      await get(
        recruiter.cookie,
        `/api/requisitions/${requisitionId}/candidates?search=ritika`,
      )
    ).body as CandidateList;
    expect(byName.items.map((c) => c.name)).toEqual(["Ritika Bansal"]);
    const bySkill = (
      await get(
        recruiter.cookie,
        `/api/requisitions/${requisitionId}/candidates?search=spring%20boot`,
      )
    ).body as CandidateList;
    expect(bySkill.items.map((c) => c.name)).toEqual(["Ritika Bansal"]);
  });

  it("shows a candidate's profile and records that it was viewed", async () => {
    const cv = await parsed("cvs/Ritika_Bansal_Resume.pdf", "Ritika Bansal");
    const res = await get(
      recruiter.cookie,
      `/api/candidates/${cv.candidateId}`,
    );
    const profile = res.body as CandidateDetail;
    expect(profile).toMatchObject({
      name: "Ritika Bansal",
      email: "ritika.bansal@example.com",
      noticeDays: 60,
      cvs: [{ fileName: "Ritika_Bansal_Resume.pdf", status: "PARSED" }],
      applications: [{ stage: "SOURCED" }],
    });
    expect(JSON.stringify(profile)).not.toContain("redactedText");
    expect(
      await prisma.auditEvent.count({
        where: {
          action: "CANDIDATE_PROFILE_VIEWED",
          entityId: cv.candidateId!,
        },
      }),
    ).toBe(1);
  });

  it("flags a possible duplicate on both candidates", async () => {
    await parsed("cvs/CV - Rohit Saxena (2024).docx", "Rohit Saxena");
    await parsed("cvs/Rohit_Saxena_Resume_latest.pdf", "Rohit Saxena");
    const list = (
      await get(
        recruiter.cookie,
        `/api/requisitions/${requisitionId}/candidates`,
      )
    ).body as CandidateList;
    expect(list.items.map((c) => c.possibleDuplicate)).toEqual([true, true]);
    const only = (
      await get(
        recruiter.cookie,
        `/api/requisitions/${requisitionId}/candidates?status=POSSIBLE_DUPLICATE`,
      )
    ).body as CandidateList;
    expect(only.total).toBe(2);
  });
});

describe("resolving a duplicate", () => {
  async function pair(secondRequisitionId = requisitionId) {
    const parse = async (path: string, reqId: string) => {
      const cv = await addCv(path, reqId, recruiter.user.id);
      await run(
        cv.id,
        deps(vi.fn().mockResolvedValue(okReply({ name: "Rohit Saxena" }))),
      );
      return cv.id;
    };
    const first = await parse(
      "cvs/CV - Rohit Saxena (2024).docx",
      requisitionId,
    );
    const second = await parse(
      "cvs/Rohit_Saxena_Resume_latest.pdf",
      secondRequisitionId,
    );
    const [link] = (
      await get(recruiter.cookie, "/api/duplicates?status=PENDING")
    ).body as PendingDuplicate[];
    return { first, second, link };
  }

  it("lists the pending pair with both profiles", async () => {
    const { link } = await pair();
    expect(link).toMatchObject({
      kind: "FUZZY",
      incoming: { name: "Rohit Saxena", phone: "9000012011" },
      existing: { name: "Rohit Saxena" },
    });
    expect(link.incoming.id).not.toBe(link.existing.id);
    expect(link.similarity).toBeGreaterThan(0.5);
  });

  it("merges the same person into one candidate with one application", async () => {
    const { first, second, link } = await pair();
    const res = await postJson(
      recruiter.cookie,
      `/api/duplicates/${link.id}/resolve`,
      { samePerson: true },
    );
    expect(res.status).toBe(200);

    expect(await prisma.candidate.count()).toBe(1);
    const cvs = await prisma.cvDocument.findMany({
      where: { id: { in: [first, second] } },
    });
    expect(new Set(cvs.map((c) => c.candidateId)).size).toBe(1);
    expect(cvs[0].candidateId).toBe(link.existing.id);
    expect(await prisma.application.findMany()).toMatchObject([
      { candidateId: link.existing.id },
    ]);
    expect(
      await prisma.duplicateLink.findUniqueOrThrow({ where: { id: link.id } }),
    ).toMatchObject({
      status: "SAME_PERSON",
      resolvedById: recruiter.user.id,
    });
    expect(
      await prisma.auditEvent.count({
        where: { action: "DUPLICATE_RESOLVED" },
      }),
    ).toBe(1);
    expect((await get(recruiter.cookie, "/api/duplicates")).body).toEqual([]);
  });

  it("moves an application to the existing candidate when it is for another requisition", async () => {
    const other = (await createRequisition(recruiter.user.id, "Other role")).id;
    const { link } = await pair(other);
    expect(await prisma.application.count()).toBe(2);

    await postJson(recruiter.cookie, `/api/duplicates/${link.id}/resolve`, {
      samePerson: true,
    });
    const apps = await prisma.application.findMany({
      orderBy: { createdAt: "asc" },
    });
    expect(apps.map((a) => a.candidateId)).toEqual([
      link.existing.id,
      link.existing.id,
    ]);
    expect(new Set(apps.map((a) => a.requisitionId)).size).toBe(2);
  });

  it("keeps two people apart and dismisses the link", async () => {
    const { link } = await pair();
    const res = await postJson(
      recruiter.cookie,
      `/api/duplicates/${link.id}/resolve`,
      { samePerson: false },
    );
    expect(res.status).toBe(200);
    expect(await prisma.candidate.count()).toBe(2);
    expect(
      await prisma.duplicateLink.findUniqueOrThrow({ where: { id: link.id } }),
    ).toMatchObject({ status: "DIFFERENT_PEOPLE" });
    expect((await get(recruiter.cookie, "/api/duplicates")).body).toEqual([]);
  });

  it("cannot be resolved twice", async () => {
    const { link } = await pair();
    await postJson(recruiter.cookie, `/api/duplicates/${link.id}/resolve`, {
      samePerson: false,
    });
    const again = await postJson(
      recruiter.cookie,
      `/api/duplicates/${link.id}/resolve`,
      { samePerson: true },
    );
    expect(again.status).toBe(409);
    expect(await prisma.candidate.count()).toBe(2);
  });

  it("scores the merged candidate again when the pair is the same person", async () => {
    const { link } = await pair();
    const queued: { applicationId: string; force?: boolean }[] = [];
    setScoreSender(async (job) => void queued.push(job));
    try {
      await postJson(recruiter.cookie, `/api/duplicates/${link.id}/resolve`, {
        samePerson: true,
      });
    } finally {
      setScoreSender(undefined);
    }
    const app = await prisma.application.findFirstOrThrow();
    expect(queued).toEqual([{ applicationId: app.id, force: true }]);
  });

  it("answers a double click with one success and one conflict", async () => {
    const { link } = await pair();
    const results = await Promise.all(
      [true, true].map((samePerson) =>
        postJson(recruiter.cookie, `/api/duplicates/${link.id}/resolve`, {
          samePerson,
        }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await prisma.candidate.count()).toBe(1);
    expect(
      await prisma.auditEvent.count({
        where: { action: "DUPLICATE_RESOLVED" },
      }),
    ).toBe(1);
  });

  it("rejects a body that is not a yes or no", async () => {
    const { link } = await pair();
    const res = await postJson(
      recruiter.cookie,
      `/api/duplicates/${link.id}/resolve`,
      { samePerson: "yes" },
    );
    expect(res.status).toBe(400);
  });
});
