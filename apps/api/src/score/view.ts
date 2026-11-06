import type {
  CriterionScore,
  ScoreDetail,
  ScoreState,
  ScoreSummary,
} from "@hireproof/shared";
import type { CandidateScore } from "../generated/prisma/client";
import { FORMULA, formulaText, poolsFor } from "./compute";

// A job claimed longer ago than this has died with its process.
const SCORING_STALE_MS = 10 * 60_000;

export const toSummary = (
  s: Pick<
    CandidateScore,
    "total" | "band" | "mustHavesMet" | "mustHavesTotal" | "flags" | "source"
  >,
): ScoreSummary => ({
  total: s.total,
  band: s.band,
  mustHavesMet: s.mustHavesMet,
  mustHavesTotal: s.mustHavesTotal,
  flagCount: s.flags.length,
  source: s.source,
});

export function toDetail(
  s: CandidateScore,
  context: {
    applicationId: string;
    candidateId: string;
    cvId: string;
    experienceYears: number | null;
  },
): ScoreDetail {
  const criteria = s.criteria as unknown as CriterionScore[];
  const musts = criteria.filter((c) => c.kind === "MUST_HAVE").length;
  const pools = poolsFor(musts, criteria.length - musts);
  return {
    ...toSummary(s),
    ...context,
    scorecardVersion: s.scorecardVersion,
    experiencePoints: s.experiencePoints,
    experienceMaxPoints: pools.experience,
    experienceYears: context.experienceYears,
    criteria,
    flags: s.flags,
    model: s.model,
    stale: s.stale,
    formula: FORMULA,
    formulaText: formulaText(pools),
    createdAt: s.createdAt.toISOString(),
  };
}

// What to say about an application that has no score for the current version.
export function pendingState(app: {
  hasOlderScore: boolean;
  scoringStartedAt: Date | null;
  hasScorableCv: boolean;
  cvInFlight: boolean;
}): Exclude<ScoreState, "SCORED"> {
  if (!app.hasScorableCv && !app.cvInFlight) return "NO_CV";
  if (app.hasOlderScore) return "RESCORING";
  if (
    app.scoringStartedAt &&
    Date.now() - app.scoringStartedAt.getTime() < SCORING_STALE_MS
  ) {
    return "SCORING";
  }
  return "WAITING";
}
