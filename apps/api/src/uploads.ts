import { createHash } from "node:crypto";
import { extname } from "node:path";
import { Router, type RequestHandler } from "express";
import multer from "multer";
import {
  CV_FINAL_STATUSES,
  CV_LIMITS,
  CreateBatchInput,
  type CvStatus,
  type FileResult,
  type UploadBatchView,
} from "@hireproof/shared";
import { requireAuth, requireRole } from "./auth";
import { enqueueCv } from "./cv/queue";
import { prisma } from "./db";
import type { Prisma } from "./generated/prisma/client";

export const uploads = Router();

const recruiterOnly = [requireAuth, requireRole("RECRUITER")];
const readers = [requireAuth, requireRole("RECRUITER", "DELIVERY_HEAD")];

// Reads each file into memory like multer's own memory storage, but a file over
// the size limit is flagged instead of failing the whole request, so the other
// files sent with it still go through.
const storage: multer.StorageEngine = {
  _handleFile(_req, file, done) {
    const chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = false;
    file.stream.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > CV_LIMITS.fileBytes) {
        tooLarge = true;
        chunks.length = 0;
      } else {
        chunks.push(chunk);
      }
    });
    file.stream.on("error", done);
    file.stream.on("end", () => {
      done(null, {
        buffer: Buffer.concat(chunks),
        size,
        tooLarge,
      } as Partial<Express.Multer.File>);
    });
  },
  _removeFile(_req, _file, done) {
    done(null);
  },
};

const receive = multer({
  storage,
  limits: { files: CV_LIMITS.requestFiles },
}).array("files", CV_LIMITS.requestFiles);

const receiveFiles: RequestHandler = (req, res, next) => {
  receive(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      const tooMany =
        err.code === "LIMIT_FILE_COUNT" || err.code === "LIMIT_UNEXPECTED_FILE";
      res.status(400).json({
        error: tooMany
          ? `Send at most ${CV_LIMITS.requestFiles} files in one request.`
          : "The upload could not be read.",
      });
      return;
    }
    next(err);
  });
};

const MIME = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
} as const;

// The bytes decide the type, and the extension has to agree with them.
export function detectType(
  buffer: Buffer,
  fileName: string,
): "pdf" | "docx" | null {
  const ext = extname(fileName).toLowerCase();
  if (buffer.subarray(0, 5).toString("latin1") === "%PDF-" && ext === ".pdf") {
    return "pdf";
  }
  if (
    buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])) &&
    ext === ".docx"
  ) {
    return "docx";
  }
  return null;
}

const cleanName = (name: string) =>
  name
    .replace(/[\\/]/g, "_")
    .replace(/\p{Cc}/gu, "")
    .slice(0, 200) || "cv";

uploads.post(
  "/api/requisitions/:id/uploads",
  ...recruiterOnly,
  async (req, res) => {
    const input = CreateBatchInput.safeParse(req.body);
    if (!input.success) {
      res.status(400).json({
        error: input.error.issues[0].message,
        fields: { expectedCount: input.error.issues[0].message },
      });
      return;
    }
    const requisition = await prisma.requisition.findUnique({
      where: { id: String(req.params.id) },
      select: { id: true },
    });
    if (!requisition) {
      res.status(404).json({ error: "Requisition not found" });
      return;
    }
    const batch = await prisma.uploadBatch.create({
      data: {
        requisitionId: requisition.id,
        uploadedById: req.user!.id,
        expectedCount: input.data.expectedCount,
      },
    });
    res.status(201).json({ batchId: batch.id });
  },
);

uploads.post(
  "/api/uploads/:batchId/files",
  ...recruiterOnly,
  receiveFiles,
  async (req, res) => {
    const batch = await prisma.uploadBatch.findUnique({
      where: { id: String(req.params.batchId) },
      include: { _count: { select: { cvs: true } } },
    });
    if (!batch) {
      res.status(404).json({ error: "Upload not found" });
      return;
    }

    const files = (req.files ?? []) as (Express.Multer.File & {
      tooLarge?: boolean;
    })[];
    let room = CV_LIMITS.batchFiles - batch._count.cvs;
    const results: FileResult[] = [];
    const created: string[] = [];

    for (const file of files) {
      const fileName = cleanName(file.originalname);
      const reject = (reason: string) =>
        results.push({ fileName, accepted: false, cvId: null, reason });

      if (file.tooLarge) {
        reject("This file is larger than 10 MB.");
        continue;
      }
      if (file.size === 0) {
        reject("This file is empty.");
        continue;
      }
      const type = detectType(file.buffer, fileName);
      if (!type) {
        reject("Only PDF and DOCX files are accepted.");
        continue;
      }
      if (room <= 0) {
        reject(`This upload already has ${CV_LIMITS.batchFiles} files.`);
        continue;
      }
      room--;
      const cv = await prisma.cvDocument.create({
        data: {
          batchId: batch.id,
          requisitionId: batch.requisitionId,
          fileName,
          mimeType: MIME[type],
          sizeBytes: file.size,
          sha256: createHash("sha256").update(file.buffer).digest("hex"),
          data: new Uint8Array(file.buffer),
        },
        select: { id: true },
      });
      created.push(cv.id);
      results.push({ fileName, accepted: true, cvId: cv.id, reason: null });
    }

    for (const id of created) await enqueueCv(id);
    res.status(201).json({ results });
  },
);

const batchInclude = {
  cvs: {
    orderBy: [{ createdAt: "asc" }, { fileName: "asc" }],
    select: {
      id: true,
      fileName: true,
      sizeBytes: true,
      status: true,
      textSource: true,
      reviewReasons: true,
      failureReason: true,
      candidate: { select: { id: true, code: true, name: true } },
      duplicateLinks: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { kind: true, reason: true },
      },
    },
  },
} satisfies Prisma.UploadBatchInclude;

export async function loadBatch(id: string): Promise<UploadBatchView | null> {
  const batch = await prisma.uploadBatch.findUnique({
    where: { id },
    include: batchInclude,
  });
  if (!batch) return null;
  const counts: UploadBatchView["counts"] = {};
  for (const cv of batch.cvs) counts[cv.status] = (counts[cv.status] ?? 0) + 1;
  return {
    id: batch.id,
    requisitionId: batch.requisitionId,
    expectedCount: batch.expectedCount,
    createdAt: batch.createdAt.toISOString(),
    done:
      batch.cvs.length >= 1 &&
      batch.cvs.every((c) =>
        (CV_FINAL_STATUSES as CvStatus[]).includes(c.status),
      ),
    counts,
    files: batch.cvs.map((c) => ({
      id: c.id,
      fileName: c.fileName,
      sizeBytes: c.sizeBytes,
      status: c.status,
      textSource: c.textSource,
      reviewReasons: c.reviewReasons,
      failureReason: c.failureReason,
      candidate: c.candidate,
      duplicate: c.duplicateLinks[0] ?? null,
    })),
  };
}

uploads.get("/api/uploads/:batchId", ...readers, async (req, res) => {
  const view = await loadBatch(String(req.params.batchId));
  if (!view) {
    res.status(404).json({ error: "Upload not found" });
    return;
  }
  res.json(view);
});

// So a recruiter who leaves the page and comes back sees the last upload.
uploads.get(
  "/api/requisitions/:id/uploads/latest",
  ...readers,
  async (req, res) => {
    const latest = await prisma.uploadBatch.findFirst({
      where: { requisitionId: String(req.params.id) },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    res.json(latest ? await loadBatch(latest.id) : null);
  },
);

uploads.post("/api/cvs/:id/retry", ...recruiterOnly, async (req, res) => {
  const cv = await prisma.cvDocument.findUnique({
    where: { id: String(req.params.id) },
    include: { candidate: { include: { _count: { select: { cvs: true } } } } },
  });
  if (!cv) {
    res.status(404).json({ error: "CV not found" });
    return;
  }
  if (cv.status !== "FAILED" && cv.status !== "NEEDS_REVIEW") {
    res.status(409).json({
      error: "Only a CV that failed or needs review can be run again.",
    });
    return;
  }
  const pending = await prisma.duplicateLink.count({
    where: {
      status: "PENDING",
      OR: [
        { cvId: cv.id },
        ...(cv.candidateId ? [{ candidateId: cv.candidateId }] : []),
      ],
    },
  });
  if (pending > 0) {
    res.status(409).json({
      error: "Resolve the possible duplicate before running this CV again.",
    });
    return;
  }

  await prisma.$transaction(async (tx) => {
    await tx.duplicateLink.deleteMany({ where: { cvId: cv.id } });
    const candidate = cv.candidate;
    await tx.cvDocument.update({
      where: { id: cv.id },
      data: {
        status: "QUEUED",
        candidateId: null,
        failureReason: null,
        reviewReasons: [],
      },
    });
    // A candidate that existed only because of this CV goes away with it; the
    // run creates whatever the new result calls for.
    if (candidate && candidate._count.cvs <= 1) {
      await tx.application.deleteMany({ where: { candidateId: candidate.id } });
      await tx.duplicateLink.deleteMany({
        where: { candidateId: candidate.id },
      });
      await tx.candidate.delete({ where: { id: candidate.id } });
    }
  });
  await enqueueCv(cv.id);
  res.json({ ok: true });
});
