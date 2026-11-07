import type {
  Band,
  CriterionScore,
  ScoreFormula,
  ScoreSource,
  ScoredQuote,
  Verdict,
} from "@hireproof/shared";

// The only place the score is calculated. Everything else passes verdicts in
// and reads the result back.
export const FORMULA: ScoreFormula = {
  version: 1,
  mustHave: 70,
  niceToHave: 20,
  experience: 10,
};

export interface Pools {
  mustHave: number;
  niceToHave: number;
  experience: number;
}

// Points a group cannot use move to the other group, and to experience when no
// criteria are left. The usual case is 70, 20 and 10.
export function poolsFor(musts: number, nices: number): Pools {
  const spare =
    (musts === 0 ? FORMULA.mustHave : 0) +
    (nices === 0 ? FORMULA.niceToHave : 0);
  if (musts > 0 && nices > 0) {
    return {
      mustHave: FORMULA.mustHave,
      niceToHave: FORMULA.niceToHave,
      experience: FORMULA.experience,
    };
  }
  if (musts > 0) {
    return {
      mustHave: FORMULA.mustHave + spare,
      niceToHave: 0,
      experience: FORMULA.experience,
    };
  }
  if (nices > 0) {
    return {
      mustHave: 0,
      niceToHave: FORMULA.niceToHave + spare,
      experience: FORMULA.experience,
    };
  }
  return { mustHave: 0, niceToHave: 0, experience: FORMULA.experience + spare };
}

export function formulaText(pools: Pools) {
  const parts = [
    pools.mustHave > 0 && `Must-haves ${pools.mustHave}`,
    pools.niceToHave > 0 && `nice-to-haves ${pools.niceToHave}`,
    `experience ${pools.experience}`,
  ].filter(Boolean);
  const text = parts.join(", ");
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}. A met criterion earns its full share and a partial one half. Nothing counts without a quote found in the CV. Strong match needs 75 or more and no must-have missing.`;
}

const STRONG_AT = 75;
const POSSIBLE_AT = 50;
// Experience outside the range loses points linearly and reaches zero here.
const FALLOFF_YEARS = 2;

export interface ScoreCard {
  experienceMinYears: number | null;
  experienceMaxYears: number | null;
  noticeMaxDays: number | null;
  ctcMaxLpa: number | null;
  locations: string[];
  criteria: { id: string; label: string; kind: CriterionScore["kind"] }[];
}

export interface ScoreProfile {
  totalExperienceYears: number | null;
  noticeDays: number | null;
  expectedCtcLpa: number | null;
  location: string | null;
}

export interface ResolvedVerdict {
  id: string;
  verdict: Verdict;
  quotes: ScoredQuote[];
  flag: string | null;
}

export interface ComputedScore {
  total: number;
  band: Band;
  mustHavesMet: number;
  mustHavesTotal: number;
  experiencePoints: number;
  experienceMaxPoints: number;
  pools: Pools;
  criteria: CriterionScore[];
  flags: string[];
}

// Strong needs the total and no must-have missing; a partial one is allowed.
export function bandFor(
  total: number,
  criteria: Pick<CriterionScore, "kind" | "verdict">[],
): Band {
  const missing = criteria.some(
    (c) => c.kind === "MUST_HAVE" && c.verdict === "NOT_FOUND",
  );
  if (total >= STRONG_AT && !missing) return "STRONG";
  return total >= POSSIBLE_AT ? "POSSIBLE" : "WEAK";
}

const SHARE: Record<Verdict, number> = { MET: 1, PARTIAL: 0.5, NOT_FOUND: 0 };
const round1 = (n: number) => Math.round(n * 10) / 10;

// 1 inside the range, falling to 0 two years outside it. A card with no range
// asks nothing of experience, so everyone fits.
export function experienceFit(
  years: number,
  min: number | null,
  max: number | null,
) {
  const gap =
    min !== null && years < min
      ? min - years
      : max !== null && years > max
        ? years - max
        : 0;
  return Math.max(0, 1 - gap / FALLOFF_YEARS);
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

const inLocations = (place: string, allowed: string[]) => {
  const p = norm(place);
  return allowed.some((a) => {
    const q = norm(a);
    return p === q || p.includes(q) || q.includes(p);
  });
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function computeScore(
  card: ScoreCard,
  verdicts: ResolvedVerdict[],
  profile: ScoreProfile,
  source: ScoreSource,
): ComputedScore {
  const byId = new Map(verdicts.map((v) => [v.id, v]));
  const musts = card.criteria.filter((c) => c.kind === "MUST_HAVE");
  const nices = card.criteria.filter((c) => c.kind === "NICE_TO_HAVE");

  const pools = poolsFor(musts.length, nices.length);
  const experiencePool = pools.experience;

  // Points are shown to one decimal but added up unrounded.
  let earned = 0;
  const criteria: CriterionScore[] = card.criteria.map((c) => {
    const v = byId.get(c.id);
    const verdict = v?.verdict ?? "NOT_FOUND";
    const pool = c.kind === "MUST_HAVE" ? pools.mustHave : pools.niceToHave;
    const count = c.kind === "MUST_HAVE" ? musts.length : nices.length;
    const maxPoints = pool / count;
    earned += maxPoints * SHARE[verdict];
    return {
      id: c.id,
      label: c.label,
      kind: c.kind,
      verdict,
      quotes: v?.quotes ?? [],
      points: round1(maxPoints * SHARE[verdict]),
      maxPoints: round1(maxPoints),
      flag: v?.flag ?? null,
    };
  });

  const flags: string[] = [];
  const years = profile.totalExperienceYears;
  const hasRange =
    card.experienceMinYears !== null || card.experienceMaxYears !== null;
  let experienceRaw: number;
  if (!hasRange) {
    experienceRaw = experiencePool;
  } else if (years === null) {
    experienceRaw = experiencePool / 2;
    flags.push("Experience is not stated in the CV, so it is scored as half.");
  } else {
    experienceRaw =
      experiencePool *
      experienceFit(years, card.experienceMinYears, card.experienceMaxYears);
  }

  const raw = earned + experienceRaw;
  const total = Math.min(100, Math.max(0, Math.round(raw)));
  const mustHavesMet = criteria.filter(
    (c) => c.kind === "MUST_HAVE" && c.verdict === "MET",
  ).length;
  const band = bandFor(total, criteria);

  if (card.noticeMaxDays !== null) {
    if (profile.noticeDays === null) flags.push("Notice period is not stated.");
    else if (profile.noticeDays > card.noticeMaxDays) {
      flags.push(
        `Notice ${plural(profile.noticeDays, "day")}, role allows ${card.noticeMaxDays}.`,
      );
    }
  }
  if (card.ctcMaxLpa !== null) {
    if (profile.expectedCtcLpa === null) {
      flags.push("Expected CTC is not stated.");
    } else if (profile.expectedCtcLpa > card.ctcMaxLpa) {
      flags.push(
        `Expects ${profile.expectedCtcLpa} LPA, budget is ${card.ctcMaxLpa} LPA.`,
      );
    }
  }
  if (card.locations.length > 0) {
    if (!profile.location) flags.push("Location is not stated.");
    else if (!inLocations(profile.location, card.locations)) {
      flags.push(
        `Based in ${profile.location}, role is in ${card.locations.join(" or ")}.`,
      );
    }
  }

  const unverified = criteria.filter(
    (c) => c.flag || c.quotes.some((q) => !q.verified),
  );
  if (unverified.length > 0) {
    flags.push(
      `The AI cited text that is not in the CV (${unverified.map((c) => c.label).join(", ")}).`,
    );
  }
  if (source === "RULES") {
    flags.push("Scored without AI. Check the evidence before relying on it.");
  }

  return {
    total,
    band,
    mustHavesMet,
    mustHavesTotal: musts.length,
    experiencePoints: Math.round(experienceRaw),
    experienceMaxPoints: experiencePool,
    pools,
    criteria,
    flags,
  };
}
