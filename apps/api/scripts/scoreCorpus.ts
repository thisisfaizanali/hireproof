import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { canonicalSkill, type Verdict } from "@hireproof/shared";
import type { Extracted } from "../src/ai/rules";
import type { ScoreCard, ScoreProfile } from "../src/score/compute";
import type { RawVerdict } from "../src/score/evidence";
import { cvTruth, type CvTruth } from "./cvCorpus";
import { truth, type JdTruth } from "./jds";

const FIXTURES = resolve(__dirname, "../prisma/fixtures");
export const SCORES_FIXTURE = resolve(FIXTURES, "scores.json");

// The sample CVs meant for each requisition. The three CVs that fit no role
// ride along in the first Kestrel pool, like a mixed pile of real applications.
// Scripts and the seed may read the evaluation labels; the app never does.
export const poolFor = (key: string) =>
  cvTruth.filter(
    (c) =>
      c.intendedRequisition === key ||
      (key === "kestrel-senior-java" && c.intendedRequisition === null),
  );

// A confirmed scorecard has been through review: flags cleared, and at least
// one must-have, taken from the ground truth when the extraction was weak.
export function reviewedScorecard(
  scorecard: Extracted,
  jd: JdTruth,
): Extracted {
  const wanted = new Set(jd.mustHaveSkills.map((s) => canonicalSkill(s) ?? s));
  return {
    ...scorecard,
    criteria: scorecard.criteria.map((c) => ({
      ...c,
      kind:
        wanted.has(c.label) || c.kind === "MUST_HAVE" ? "MUST_HAVE" : c.kind,
      needsReview: false,
    })),
  };
}

interface ScorecardFixture {
  model: string;
  scorecards: Record<string, { scorecard: Extracted }>;
}

interface ParseFixture {
  parses: Record<
    string,
    {
      redactedText: string;
      profile: {
        totalExperienceYears: number | null;
        noticeDays: number | null;
        expectedCtcLpa: number | null;
        location: string | null;
      };
    }
  >;
}

const readJson = <T>(name: string): T =>
  JSON.parse(readFileSync(resolve(FIXTURES, name), "utf8")) as T;

export interface Target {
  key: string;
  title: string;
  card: ScoreCard;
  cvs: { truth: CvTruth; redactedText: string; profile: ScoreProfile }[];
}

// Every seeded requisition with its reviewed scorecard and CV pool, as they
// were captured, so capture, seed and evaluation all score the same inputs.
export function targets(): Target[] {
  const scorecards = readJson<ScorecardFixture>("scorecards.json").scorecards;
  const parses = readJson<ParseFixture>("cv-parses.json").parses;
  return truth.flatMap((jd) => {
    const captured = scorecards[jd.key];
    if (!captured) return [];
    const s = reviewedScorecard(captured.scorecard, jd);
    return [
      {
        key: jd.key,
        title: jd.title,
        card: {
          experienceMinYears: s.experience.minYears,
          experienceMaxYears: s.experience.maxYears,
          noticeMaxDays: s.notice.maxDays,
          ctcMaxLpa: s.ctc.maxLpa,
          locations: s.locations.values,
          criteria: s.criteria.map((c) => ({
            id: c.label,
            label: c.label,
            kind: c.kind,
          })),
        },
        cvs: poolFor(jd.key).flatMap((t) => {
          const parse = parses[t.file];
          return parse
            ? [
                {
                  truth: t,
                  redactedText: parse.redactedText,
                  profile: {
                    totalExperienceYears: parse.profile.totalExperienceYears,
                    noticeDays: parse.profile.noticeDays,
                    expectedCtcLpa: parse.profile.expectedCtcLpa,
                    location: parse.profile.location,
                  },
                },
              ]
            : [];
        }),
      },
    ];
  });
}

// What the model said for one CV, by criterion label, before any checking.
export interface CapturedScore {
  outcome: string;
  model: string;
  latencyMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  verdicts: { label: string; verdict: Verdict; quotes: string[] }[];
}

export interface ScoreFixture {
  model: string | null;
  capturedAt: string;
  scores: Record<string, Record<string, CapturedScore>>;
}

export const readScoreFixture = (): ScoreFixture | null =>
  existsSync(SCORES_FIXTURE)
    ? (JSON.parse(readFileSync(SCORES_FIXTURE, "utf8")) as ScoreFixture)
    : null;

export const writeScoreFixture = (fixture: ScoreFixture) =>
  writeFileSync(SCORES_FIXTURE, JSON.stringify(fixture, null, 2) + "\n");

// Criteria in a scorecard are known by label when captured, by id when scored.
export function fixtureVerdicts(
  captured: CapturedScore,
  criteria: { id: string; label: string }[],
): RawVerdict[] {
  const byLabel = new Map(criteria.map((c) => [c.label, c.id]));
  return captured.verdicts.flatMap((v) => {
    const id = byLabel.get(v.label);
    return id ? [{ id, verdict: v.verdict, quotes: v.quotes }] : [];
  });
}
