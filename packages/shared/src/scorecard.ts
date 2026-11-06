import { z } from "zod";

export const CriterionKind = z.enum(["MUST_HAVE", "NICE_TO_HAVE"]);
export type CriterionKind = z.infer<typeof CriterionKind>;

export const RequisitionStatus = z.enum(["DRAFT", "OPEN", "ON_HOLD", "CLOSED"]);
export type RequisitionStatus = z.infer<typeof RequisitionStatus>;

export const ScorecardSource = z.enum(["AI", "RULES", "MANUAL"]);
export type ScorecardSource = z.infer<typeof ScorecardSource>;

export const ScorecardStatus = z.enum(["DRAFT", "CONFIRMED"]);
export type ScorecardStatus = z.infer<typeof ScorecardStatus>;

export const AiOutcome = z.enum([
  "OK",
  "RETRIED_OK",
  "INVALID_OUTPUT",
  "PROVIDER_ERROR",
  "NOT_CONFIGURED",
]);
export type AiOutcome = z.infer<typeof AiOutcome>;

export const LIMITS = {
  years: { min: 0, max: 40 },
  days: { min: 0, max: 180 },
  lpa: { min: 0, max: 200 },
  jdChars: 30000,
  jdFileBytes: 2 * 1024 * 1024,
  criteria: 60,
  locations: 20,
} as const;

const label = z
  .string()
  .trim()
  .min(1, "Enter a requirement")
  .max(200, "Keep it under 200 characters");

// What the model is asked to return. Everything it could not find is null.
const nullableNumber = z.number().nullable();
const quote = z.string().nullable();

export const LlmScorecard = z.object({
  title: z.string().nullable(),
  criteria: z.array(
    z.object({ kind: CriterionKind, label: z.string(), sourceQuote: quote }),
  ),
  experience: z.object({
    minYears: nullableNumber,
    maxYears: nullableNumber,
    sourceQuote: quote,
  }),
  notice: z.object({ maxDays: nullableNumber, sourceQuote: quote }),
  ctc: z.object({ maxLpa: nullableNumber, sourceQuote: quote }),
  locations: z.object({ values: z.array(z.string()), sourceQuote: quote }),
  ambiguities: z.array(z.string()),
});
export type LlmScorecard = z.infer<typeof LlmScorecard>;

// A constraint as stored and shown: the value, the JD text it came from, and
// whether a person still has to look at it.
interface Cited {
  sourceQuote: string | null;
  needsReview: boolean;
}

export interface CriterionView extends Cited {
  id?: string;
  kind: CriterionKind;
  label: string;
}

export interface ScorecardFields {
  criteria: CriterionView[];
  experience: Cited & { minYears: number | null; maxYears: number | null };
  notice: Cited & { maxDays: number | null };
  ctc: Cited & { maxLpa: number | null };
  locations: Cited & { values: string[] };
  ambiguities: string[];
}

export interface ScorecardView extends ScorecardFields {
  source: ScorecardSource;
  model: string | null;
  status: ScorecardStatus;
  version: number;
  confirmedAt: string | null;
}

export interface RequisitionSummary {
  id: string;
  number: number;
  title: string;
  status: RequisitionStatus;
  client: { id: string; name: string };
  owner: { id: string; name: string };
  scorecardStatus: ScorecardStatus | null;
  criteriaCount: number;
  createdAt: string;
}

export interface RequisitionDetail {
  id: string;
  number: number;
  title: string;
  status: RequisitionStatus;
  jdText: string;
  jdFileName: string | null;
  client: { id: string; name: string };
  owner: { id: string; name: string };
  scorecard: ScorecardView | null;
  extraction: { outcome: AiOutcome; model: string; createdAt: string } | null;
  createdAt: string;
}

export const formatReqNumber = (n: number) =>
  `REQ-${String(n).padStart(4, "0")}`;

const optionalNumber = (range: { min: number; max: number }, what: string) =>
  z
    .number()
    .min(range.min, `${what} cannot be below ${range.min}`)
    .max(range.max, `${what} cannot be above ${range.max}`)
    .nullable();

// Full replacement sent by the editor. Quotes and review flags are not accepted
// from the client; the server keeps what it stored for anything left unchanged.
export const ScorecardInput = z
  .object({
    criteria: z
      .array(
        z.object({
          id: z.string().optional(),
          kind: CriterionKind,
          label,
          reviewed: z.boolean().optional(),
        }),
      )
      .max(LIMITS.criteria, "Too many requirements"),
    experience: z.object({
      minYears: optionalNumber(LIMITS.years, "Experience"),
      maxYears: optionalNumber(LIMITS.years, "Experience"),
    }),
    notice: z.object({
      maxDays: z
        .number()
        .int("Use whole days")
        .min(LIMITS.days.min)
        .max(
          LIMITS.days.max,
          `Notice period cannot be above ${LIMITS.days.max}`,
        )
        .nullable(),
    }),
    ctc: z.object({ maxLpa: optionalNumber(LIMITS.lpa, "CTC") }),
    locations: z
      .array(z.string().trim().min(1).max(60))
      .max(LIMITS.locations, "Too many locations"),
    reviewed: z
      .object({
        experience: z.boolean(),
        notice: z.boolean(),
        ctc: z.boolean(),
        locations: z.boolean(),
      })
      .partial()
      .optional(),
    confirm: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    const { minYears, maxYears } = value.experience;
    if (minYears !== null && maxYears !== null && minYears > maxYears) {
      ctx.addIssue({
        code: "custom",
        path: ["experience", "maxYears"],
        message: "Maximum experience must be at least the minimum",
      });
    }
    if (value.confirm && !value.criteria.some((c) => c.kind === "MUST_HAVE")) {
      ctx.addIssue({
        code: "custom",
        path: ["criteria"],
        message: "Add at least one must-have before confirming",
      });
    }
  });
export type ScorecardInput = z.infer<typeof ScorecardInput>;

export const REQUISITION_STATUS_CHOICES = RequisitionStatus.exclude(["DRAFT"]);

export const RequisitionPatch = z
  .object({
    title: z.string().trim().min(1, "Enter a title").max(120).optional(),
    status: REQUISITION_STATUS_CHOICES.optional(),
  })
  .refine((v) => v.title !== undefined || v.status !== undefined, {
    message: "Nothing to change",
  });
export type RequisitionPatch = z.infer<typeof RequisitionPatch>;

const keep = (char: string) => /[\p{L}\p{N}]/u.test(char);

// Locates a quote inside the text, ignoring case, spacing, punctuation and
// quote styles. Returns offsets into the original text, or null.
export function findQuote(
  text: string,
  quoteText: string,
): { start: number; end: number } | null {
  let flat = "";
  const start: number[] = [];
  const end: number[] = [];
  let i = 0;
  for (const char of text) {
    if (keep(char)) {
      for (const unit of char.toLowerCase()) {
        for (let k = 0; k < unit.length; k++) {
          start.push(i);
          end.push(i + char.length);
        }
        flat += unit;
      }
    }
    i += char.length;
  }
  const wanted = [...quoteText].filter(keep).join("").toLowerCase();
  if (wanted.length < 3) return null;
  const at = flat.indexOf(wanted);
  if (at < 0) return null;
  return { start: start[at], end: end[at + wanted.length - 1] };
}
