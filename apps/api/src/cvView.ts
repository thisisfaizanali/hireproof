import { Router, type Request, type Response } from "express";
import { z } from "zod";
import type { CvText } from "@hireproof/shared";
import { audit } from "./audit";
import { requireAuth, requireRole } from "./auth";
import { prisma } from "./db";

export const cvView = Router();

// Client hiring managers get their own masked view in a later release.
const readers = [requireAuth, requireRole("RECRUITER", "DELIVERY_HEAD")];

const Context = z.object({ requisition: z.string().max(40).optional() });

// Every time a person opens a CV it is logged, whether as the original file or
// as text. The screening gate reads these events.
async function open(req: Request, res: Response) {
  const cv = await prisma.cvDocument.findUnique({
    where: { id: String(req.params.id) },
    select: {
      id: true,
      candidateId: true,
      requisitionId: true,
      fileName: true,
      mimeType: true,
    },
  });
  if (!cv) {
    res.status(404).json({ error: "CV not found" });
    return null;
  }
  const context = Context.safeParse(req.query);
  const asked = context.success ? context.data.requisition : undefined;
  const requisitionId =
    asked && (await prisma.requisition.count({ where: { id: asked } })) > 0
      ? asked
      : cv.requisitionId;
  await audit({
    action: "CV_VIEWED",
    actorId: req.user!.id,
    entityType: "CvDocument",
    entityId: cv.id,
    meta: { candidateId: cv.candidateId, requisitionId },
    ip: req.ip,
  });
  return cv;
}

// A name that is safe in a header: plain characters for old clients and the
// real name, percent-encoded, for the rest.
function contentDisposition(fileName: string) {
  const plain = fileName.replace(/[^A-Za-z0-9._ -]/g, "_");
  return `inline; filename="${plain}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

cvView.get("/api/cvs/:id/file", ...readers, async (req, res) => {
  const cv = await open(req, res);
  if (!cv) return;
  const row = await prisma.cvDocument.findUniqueOrThrow({
    where: { id: cv.id },
    select: { data: true },
  });
  res.set({
    "Content-Type": cv.mimeType,
    "Content-Disposition": contentDisposition(cv.fileName),
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, no-store",
    // The file is data to display, never a page: no scripts, no outside loads.
    "Content-Security-Policy":
      "default-src 'none'; style-src 'unsafe-inline'; img-src data:; frame-ancestors 'self'",
  });
  res.send(Buffer.from(row.data));
});

cvView.get("/api/cvs/:id/text", ...readers, async (req, res) => {
  const cv = await open(req, res);
  if (!cv) return;
  const row = await prisma.cvDocument.findUniqueOrThrow({
    where: { id: cv.id },
    select: {
      text: true,
      textSource: true,
      ocrConfidence: true,
      reviewReasons: true,
    },
  });
  if (row.text === null) {
    res.status(404).json({
      error: "No text could be read from this file. Open the original.",
    });
    return;
  }
  const body: CvText = {
    id: cv.id,
    fileName: cv.fileName,
    mimeType: cv.mimeType,
    text: row.text,
    textSource: row.textSource,
    ocrConfidence: row.ocrConfidence,
    reviewReasons: row.reviewReasons,
  };
  res.set("Cache-Control", "private, no-store").json(body);
});
