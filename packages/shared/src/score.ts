import { z } from "zod";

export const Verdict = z.enum(["MET", "PARTIAL", "NOT_FOUND"]);
export type Verdict = z.infer<typeof Verdict>;

export const Band = z.enum(["STRONG", "POSSIBLE", "WEAK"]);
export type Band = z.infer<typeof Band>;

export const BAND_LABEL: Record<Band, string> = {
  STRONG: "Strong match",
  POSSIBLE: "Possible match",
  WEAK: "Weak match",
};

export const REJECT_REASONS = [
  ["SKILLS_GAP", "Skills gap"],
  ["EXPERIENCE", "Experience"],
  ["NOTICE_PERIOD", "Notice period"],
  ["CTC", "CTC"],
  ["LOCATION", "Location"],
  ["OTHER", "Other"],
] as const;

export const RejectReason = z.enum([
  "SKILLS_GAP",
  "EXPERIENCE",
  "NOTICE_PERIOD",
  "CTC",
  "LOCATION",
  "OTHER",
]);
export type RejectReason = z.infer<typeof RejectReason>;

export const RejectInput = z
  .object({
    reason: RejectReason,
    note: z
      .string()
      .trim()
      .max(500, "Keep the note under 500 characters")
      .optional(),
  })
  .superRefine((value, ctx) => {
    if (value.reason === "OTHER" && !value.note) {
      ctx.addIssue({
        code: "custom",
        path: ["note"],
        message: "Say why in a few words",
      });
    }
  });
export type RejectInput = z.infer<typeof RejectInput>;

export const SCREEN_GATE_MESSAGE =
  "Open the CV before marking this candidate screened.";

export interface ScoredQuote {
  text: string;
  verified: boolean;
}

export interface CriterionScore {
  id: string;
  label: string;
  kind: "MUST_HAVE" | "NICE_TO_HAVE";
  verdict: Verdict;
  quotes: ScoredQuote[];
  points: number;
  maxPoints: number;
  flag: string | null;
}

export type ScoreSource = "AI" | "RULES";

export interface ScoreFormula {
  version: number;
  mustHave: number;
  niceToHave: number;
  experience: number;
}

export interface ScoreSummary {
  total: number;
  band: Band;
  mustHavesMet: number;
  mustHavesTotal: number;
  flagCount: number;
  source: ScoreSource;
}

export interface ScoreDetail extends ScoreSummary {
  applicationId: string;
  candidateId: string;
  cvId: string;
  scorecardVersion: number;
  experiencePoints: number;
  experienceMaxPoints: number;
  experienceYears: number | null;
  criteria: CriterionScore[];
  flags: string[];
  model: string | null;
  stale: boolean;
  formula: ScoreFormula;
  formulaText: string;
  createdAt: string;
}

export type ScoreState =
  "SCORED" | "WAITING" | "SCORING" | "RESCORING" | "NO_CV";

export const SCORE_STATE_LABEL: Record<
  Exclude<ScoreState, "SCORED">,
  string
> = {
  WAITING: "Waiting to be scored",
  SCORING: "Scoring",
  RESCORING: "Re-scoring",
  NO_CV: "No readable CV",
};

export const BAND_FILTERS = ["STRONG", "POSSIBLE", "WEAK", "UNSCORED"] as const;
export const STAGE_FILTERS = ["SOURCED", "SCREENED", "REJECTED"] as const;
