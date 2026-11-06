import { parse } from "node:path";
import {
  Router,
  type RequestHandler,
  type Response as ExpressResponse,
} from "express";
import multer from "multer";
import { z } from "zod";
import {
  LIMITS,
  RequisitionPatch,
  RequisitionStatus,
  ScorecardInput,
  type RequisitionDetail,
  type RequisitionSummary,
} from "@hireproof/shared";
import { extractScorecard, type Extraction } from "./ai/extract";
import { audit } from "./audit";
import { requireAuth, requireRole } from "./auth";
import { prisma } from "./db";
import { ExtractError, extractText, type ExtractErrorCode } from "./extract";
import type { Prisma } from "./generated/prisma/client";

export const requisitions = Router();

const recruiterOnly = [requireAuth, requireRole("RECRUITER")];
const readers = [requireAuth, requireRole("RECRUITER", "DELIVERY_HEAD")];

const detailInclude = {
  client: { select: { id: true, name: true } },
  owner: { select: { id: true, name: true } },
  scorecard: { include: { criteria: { orderBy: { position: "asc" } } } },
  aiRuns: {
    where: { kind: "JD_EXTRACT" },
    orderBy: { createdAt: "desc" },
    take: 1,
  },
} satisfies Prisma.RequisitionInclude;

type DetailRow = Prisma.RequisitionGetPayload<{
  include: typeof detailInclude;
}>;

function toDetail(row: DetailRow): RequisitionDetail {
  const s = row.scorecard;
  const run = row.aiRuns[0];
  return {
    id: row.id,
    number: row.number,
    title: row.title,
    status: row.status,
    jdText: row.jdText,
    jdFileName: row.jdFileName,
    client: row.client,
    owner: row.owner,
    createdAt: row.createdAt.toISOString(),
    extraction: run && {
      outcome: run.outcome,
      model: run.model,
      createdAt: run.createdAt.toISOString(),
    },
    scorecard: s && {
      source: s.source,
      model: s.model,
      status: s.status,
      version: s.version,
      confirmedAt: s.confirmedAt?.toISOString() ?? null,
      ambiguities: s.ambiguities,
      criteria: s.criteria.map((c) => ({
        id: c.id,
        kind: c.kind,
        label: c.label,
        sourceQuote: c.sourceQuote,
        needsReview: c.needsReview,
      })),
      experience: {
        minYears: s.experienceMinYears,
        maxYears: s.experienceMaxYears,
        sourceQuote: s.experienceQuote,
        needsReview: s.experienceReview,
      },
      notice: {
        maxDays: s.noticeMaxDays,
        sourceQuote: s.noticeQuote,
        needsReview: s.noticeReview,
      },
      ctc: {
        maxLpa: s.ctcMaxLpa,
        sourceQuote: s.ctcQuote,
        needsReview: s.ctcReview,
      },
      locations: {
        values: s.locations,
        sourceQuote: s.locationsQuote,
        needsReview: s.locationsReview,
      },
    },
  };
}

const loadDetail = (id: string) =>
  prisma.requisition.findUnique({ where: { id }, include: detailInclude });

function fieldErrors(res: ExpressResponse, error: z.ZodError) {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "form";
    fields[key] ??= issue.message;
  }
  res.status(400).json({ error: "Check the highlighted fields", fields });
}

const notFound = (res: ExpressResponse) =>
  res.status(404).json({ error: "Requisition not found" });

export type SeedExtraction = Pick<Extraction, "scorecard" | "source" | "model">;

export function scorecardData(e: SeedExtraction) {
  const s = e.scorecard;
  return {
    experienceMinYears: s.experience.minYears,
    experienceMaxYears: s.experience.maxYears,
    experienceQuote: s.experience.sourceQuote,
    experienceReview: s.experience.needsReview,
    noticeMaxDays: s.notice.maxDays,
    noticeQuote: s.notice.sourceQuote,
    noticeReview: s.notice.needsReview,
    ctcMaxLpa: s.ctc.maxLpa,
    ctcQuote: s.ctc.sourceQuote,
    ctcReview: s.ctc.needsReview,
    locations: s.locations.values,
    locationsQuote: s.locations.sourceQuote,
    locationsReview: s.locations.needsReview,
    ambiguities: s.ambiguities,
    source: e.source,
    model: e.model,
    status: "DRAFT" as const,
  };
}

export const criteriaRows = (e: SeedExtraction) =>
  e.scorecard.criteria.map((c, position) => ({
    kind: c.kind,
    label: c.label,
    sourceQuote: c.sourceQuote,
    needsReview: c.needsReview,
    position,
  }));

const NOT_A_TITLE = /^(hi|hello|dear)\b|^(from|to|subject|sent):/i;

// Used when the person typed no title and the AI gave none.
export function deriveTitle(jdText: string, fileName: string | null) {
  const line = jdText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l && !NOT_A_TITLE.test(l));
  if (line && line.length < 80) return line;
  const base = fileName && parse(fileName).name.trim();
  return base || "Untitled requisition";
}

const aiRunRow = (e: Extraction, requisitionId: string) => ({
  kind: "JD_EXTRACT",
  requisitionId,
  ...e.run,
});

// Lists

const ListQuery = z.object({
  status: RequisitionStatus.optional(),
  clientId: z.string().min(1).optional(),
  mine: z.enum(["true", "false"]).optional(),
});

requisitions.get("/api/requisitions", ...readers, async (req, res) => {
  const query = ListQuery.safeParse(req.query);
  if (!query.success) return fieldErrors(res, query.error);
  const { status, clientId, mine } = query.data;

  const rows = await prisma.requisition.findMany({
    where: {
      status,
      clientId,
      ownerId: mine === "true" ? req.user!.id : undefined,
    },
    include: {
      client: { select: { id: true, name: true } },
      owner: { select: { id: true, name: true } },
      scorecard: {
        select: { status: true, _count: { select: { criteria: true } } },
      },
    },
    orderBy: { number: "desc" },
  });

  const list: RequisitionSummary[] = rows.map((r) => ({
    id: r.id,
    number: r.number,
    title: r.title,
    status: r.status,
    client: r.client,
    owner: r.owner,
    scorecardStatus: r.scorecard?.status ?? null,
    criteriaCount: r.scorecard?._count.criteria ?? 0,
    createdAt: r.createdAt.toISOString(),
  }));
  res.json(list);
});

requisitions.get("/api/requisitions/:id", ...readers, async (req, res) => {
  const row = await loadDetail(String(req.params.id));
  if (!row) return notFound(res);
  res.json(toDetail(row));
});

// Create

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: LIMITS.jdFileBytes, files: 1 },
}).single("jdFile");

const receiveFile: RequestHandler = (req, res, next) => {
  upload(req, res, (err) => {
    if (!(err instanceof multer.MulterError)) return next(err);
    const tooBig = err.code === "LIMIT_FILE_SIZE";
    res.status(400).json({
      error: "Check the highlighted fields",
      fields: {
        jdFile: tooBig
          ? "The file is larger than 2 MB."
          : "The upload could not be read.",
      },
    });
  });
};

const FILE_PROBLEMS: Record<ExtractErrorCode, string> = {
  unsupported: "Upload a .pdf, .docx or .txt file.",
  empty:
    "No text could be read from this file. If it is a scan, paste the text instead.",
  unreadable: "This file could not be read. It may be damaged.",
  encrypted:
    "This file is password protected. Remove the password and upload it again.",
};

const CreateInput = z.object({
  clientId: z.string().min(1, "Choose a client"),
  title: z
    .string()
    .trim()
    .max(120, "Keep the title under 120 characters")
    .optional(),
  jdText: z.string().optional(),
});

requisitions.post(
  "/api/requisitions",
  ...recruiterOnly,
  receiveFile,
  async (req, res) => {
    const input = CreateInput.safeParse(req.body ?? {});
    if (!input.success) return fieldErrors(res, input.error);
    const { clientId, title } = input.data;
    const pasted = input.data.jdText?.trim() ?? "";
    const file = req.file;

    if (file && pasted) {
      return res.status(400).json({
        error: "Check the highlighted fields",
        fields: { jdText: "Paste the text or upload a file, not both." },
      });
    }

    let jdText = pasted;
    if (file) {
      try {
        jdText = (await extractText(file.buffer, file.originalname)).text;
      } catch (err) {
        if (!(err instanceof ExtractError)) throw err;
        return res.status(400).json({
          error: "Check the highlighted fields",
          fields: { jdFile: FILE_PROBLEMS[err.code] },
        });
      }
    }
    if (jdText.length < 20) {
      return res.status(400).json({
        error: "Check the highlighted fields",
        fields: { jdText: "Paste the job description or upload a file." },
      });
    }
    if (jdText.length > LIMITS.jdChars) {
      return res.status(400).json({
        error: "Check the highlighted fields",
        fields: {
          jdText: `The job description is longer than ${LIMITS.jdChars.toLocaleString("en-IN")} characters.`,
        },
      });
    }

    const client = await prisma.client.findUnique({ where: { id: clientId } });
    if (!client) {
      return res.status(400).json({
        error: "Check the highlighted fields",
        fields: { clientId: "Choose a client" },
      });
    }

    const extraction = await extractScorecard(jdText);
    const created = await prisma.$transaction(async (tx) => {
      const row = await tx.requisition.create({
        data: {
          clientId,
          ownerId: req.user!.id,
          title:
            title ||
            extraction.scorecard.title ||
            deriveTitle(jdText, file?.originalname ?? null),
          jdText,
          jdFileName: file?.originalname ?? null,
          scorecard: {
            create: {
              ...scorecardData(extraction),
              criteria: { create: criteriaRows(extraction) },
            },
          },
        },
      });
      await tx.aiRun.create({ data: aiRunRow(extraction, row.id) });
      return row;
    });

    await audit({
      action: "REQUISITION_CREATED",
      actorId: req.user!.id,
      entityType: "Requisition",
      entityId: created.id,
      meta: { clientId, fromFile: Boolean(file) },
      ip: req.ip,
    });
    await audit({
      action: "SCORECARD_EXTRACTED",
      actorId: req.user!.id,
      entityType: "Requisition",
      entityId: created.id,
      meta: { source: extraction.source, outcome: extraction.run.outcome },
      ip: req.ip,
    });

    res.status(201).json(toDetail((await loadDetail(created.id))!));
  },
);

// Scorecard

const ExtractInput = z.object({ force: z.boolean().optional() });

requisitions.post(
  "/api/requisitions/:id/scorecard/extract",
  ...recruiterOnly,
  async (req, res) => {
    const input = ExtractInput.safeParse(req.body ?? {});
    if (!input.success) return fieldErrors(res, input.error);
    const row = await loadDetail(String(req.params.id));
    if (!row?.scorecard) return notFound(res);
    if (row.scorecard.status === "CONFIRMED" && !input.data.force) {
      return res.status(409).json({
        error:
          "The scorecard is confirmed. Extracting again replaces it; send force to continue.",
      });
    }

    const extraction = await extractScorecard(row.jdText);
    await prisma.$transaction([
      prisma.criterion.deleteMany({ where: { scorecardId: row.scorecard.id } }),
      prisma.scorecard.update({
        where: { id: row.scorecard.id },
        data: {
          ...scorecardData(extraction),
          criteria: { create: criteriaRows(extraction) },
        },
      }),
      prisma.aiRun.create({ data: aiRunRow(extraction, row.id) }),
    ]);
    await audit({
      action: "SCORECARD_EXTRACTED",
      actorId: req.user!.id,
      entityType: "Requisition",
      entityId: row.id,
      meta: { source: extraction.source, outcome: extraction.run.outcome },
      ip: req.ip,
    });
    res.json(toDetail((await loadDetail(row.id))!));
  },
);

// What a person edited loses its review flag. Quotes stay as the JD evidence.
const carry = (
  prev: { quote: string | null; review: boolean },
  changed: boolean,
  hasValue: boolean,
  reviewed = false,
) => ({
  quote: hasValue ? prev.quote : null,
  review: hasValue && prev.review && !changed && !reviewed,
});

requisitions.put(
  "/api/requisitions/:id/scorecard",
  ...recruiterOnly,
  async (req, res) => {
    const input = ScorecardInput.safeParse(req.body);
    if (!input.success) return fieldErrors(res, input.error);
    const body = input.data;

    const row = await loadDetail(String(req.params.id));
    if (!row?.scorecard) return notFound(res);
    const old = row.scorecard;

    const previous = new Map(old.criteria.map((c) => [c.id, c]));
    const criteria = body.criteria.map((c, position) => {
      const prev = c.id ? previous.get(c.id) : undefined;
      if (prev) previous.delete(prev.id);
      const edited = !prev || prev.label !== c.label || prev.kind !== c.kind;
      return {
        ...(prev && { id: prev.id }),
        kind: c.kind,
        label: c.label,
        position,
        sourceQuote: prev?.sourceQuote ?? null,
        needsReview: Boolean(prev?.needsReview) && !edited && !c.reviewed,
      };
    });

    const places = [
      ...new Map(body.locations.map((p) => [p.toLowerCase(), p])).values(),
    ];
    const sameLocations =
      places.join("|").toLowerCase() === old.locations.join("|").toLowerCase();
    const { minYears, maxYears } = body.experience;
    const experience = carry(
      { quote: old.experienceQuote, review: old.experienceReview },
      minYears !== old.experienceMinYears ||
        maxYears !== old.experienceMaxYears,
      minYears !== null || maxYears !== null,
      body.reviewed?.experience,
    );
    const notice = carry(
      { quote: old.noticeQuote, review: old.noticeReview },
      body.notice.maxDays !== old.noticeMaxDays,
      body.notice.maxDays !== null,
      body.reviewed?.notice,
    );
    const ctc = carry(
      { quote: old.ctcQuote, review: old.ctcReview },
      body.ctc.maxLpa !== old.ctcMaxLpa,
      body.ctc.maxLpa !== null,
      body.reviewed?.ctc,
    );
    const where = carry(
      { quote: old.locationsQuote, review: old.locationsReview },
      !sameLocations,
      places.length > 0,
      body.reviewed?.locations,
    );

    const confirm = body.confirm === true;
    const pending = [
      ...criteria.filter((c) => c.needsReview).map((c) => c.label),
      ...(experience.review ? ["Experience"] : []),
      ...(notice.review ? ["Notice period"] : []),
      ...(ctc.review ? ["CTC budget"] : []),
      ...(where.review ? ["Locations"] : []),
    ];
    if (confirm && pending.length > 0) {
      return res.status(422).json({
        error: `${pending.length} ${pending.length === 1 ? "item still needs" : "items still need"} review before confirming.`,
        pending,
      });
    }
    const becomesOpen = confirm && row.status === "DRAFT";

    await prisma.$transaction([
      prisma.criterion.deleteMany({ where: { scorecardId: old.id } }),
      prisma.scorecard.update({
        where: { id: old.id },
        data: {
          experienceMinYears: minYears,
          experienceMaxYears: maxYears,
          experienceQuote: experience.quote,
          experienceReview: experience.review,
          noticeMaxDays: body.notice.maxDays,
          noticeQuote: notice.quote,
          noticeReview: notice.review,
          ctcMaxLpa: body.ctc.maxLpa,
          ctcQuote: ctc.quote,
          ctcReview: ctc.review,
          locations: places,
          locationsQuote: where.quote,
          locationsReview: where.review,
          status: confirm ? "CONFIRMED" : "DRAFT",
          ...(confirm && {
            version: { increment: 1 },
            confirmedAt: new Date(),
            confirmedById: req.user!.id,
          }),
          criteria: { create: criteria },
        },
      }),
      ...(becomesOpen
        ? [
            prisma.requisition.update({
              where: { id: row.id },
              data: { status: "OPEN" },
            }),
          ]
        : []),
    ]);

    if (confirm) {
      await audit({
        action: "SCORECARD_CONFIRMED",
        actorId: req.user!.id,
        entityType: "Requisition",
        entityId: row.id,
        meta: { version: old.version + 1 },
        ip: req.ip,
      });
    }
    if (becomesOpen) {
      await audit({
        action: "REQUISITION_STATUS_CHANGED",
        actorId: req.user!.id,
        entityType: "Requisition",
        entityId: row.id,
        meta: { from: "DRAFT", to: "OPEN" },
        ip: req.ip,
      });
    }
    res.json(toDetail((await loadDetail(row.id))!));
  },
);

// Title and status

requisitions.patch(
  "/api/requisitions/:id",
  ...recruiterOnly,
  async (req, res) => {
    const input = RequisitionPatch.safeParse(req.body);
    if (!input.success) return fieldErrors(res, input.error);
    const { title, status } = input.data;

    const row = await prisma.requisition.findUnique({
      where: { id: String(req.params.id) },
    });
    if (!row) return notFound(res);
    if (row.status === "DRAFT" && (status === "OPEN" || status === "ON_HOLD")) {
      return res.status(409).json({
        error: "Confirm the scorecard before opening the requisition.",
      });
    }

    await prisma.requisition.update({
      where: { id: row.id },
      data: { title, status },
    });
    if (status && status !== row.status) {
      await audit({
        action: "REQUISITION_STATUS_CHANGED",
        actorId: req.user!.id,
        entityType: "Requisition",
        entityId: row.id,
        meta: { from: row.status, to: status },
        ip: req.ip,
      });
    }
    res.json(toDetail((await loadDetail(row.id))!));
  },
);
