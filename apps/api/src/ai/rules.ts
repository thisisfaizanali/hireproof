import {
  LIMITS,
  findSkills,
  type CriterionView,
  type ScorecardFields,
} from "@hireproof/shared";

export type Extracted = ScorecardFields & { title: string | null };

const NUM = String.raw`(\d+(?:\.\d+)?)`;
const RANGE = String.raw`\s*(?:-|–|to)\s*`;

const EXPERIENCE_RANGE = new RegExp(
  String.raw`${NUM}${RANGE}${NUM}\s*\+?\s*(?:years?|yrs?)`,
  "i",
);
const EXPERIENCE_MIN = new RegExp(
  String.raw`(?:minimum|min\.?|at least|around|about)\s*${NUM}\s*\+?\s*(?:years?|yrs?)|${NUM}\s*\+\s*(?:years?|yrs?)`,
  "i",
);
const NOTICE_DAYS = /notice[^\n]{0,40}?(\d{1,3})\s*(days?|months?)/i;
const NOTICE_IMMEDIATE =
  /notice(?: period)?[^\n]{0,20}immediate|immediate(?:ly)?\s+join\w*/i;
const CTC = new RegExp(
  String.raw`${NUM}(?:${RANGE}${NUM})?\s*(?:lpa|lakhs?|lacs?)\b`,
  "i",
);
const LOCATION_LINE = /locations?\s*[:-]\s*([^\n]+)/i;

const cited = (needsReview: boolean, sourceQuote: string | null) => ({
  sourceQuote,
  needsReview,
});

function sentenceAround(text: string, index: number): string {
  const before = text.slice(0, index).search(/[.!?\n][^.!?\n]*$/);
  const start = before < 0 ? 0 : before + 1;
  const after = text.slice(index).search(/[.!?\n]/);
  const end = after < 0 ? text.length : index + after;
  return text.slice(start, end).trim().slice(0, 240);
}

function experience(text: string): Extracted["experience"] {
  const range = EXPERIENCE_RANGE.exec(text);
  if (range) {
    return {
      minYears: Number(range[1]),
      maxYears: Number(range[2]),
      ...cited(true, range[0]),
    };
  }
  const single = EXPERIENCE_MIN.exec(text);
  if (single) {
    return {
      minYears: Number(single[1] ?? single[2]),
      maxYears: null,
      ...cited(true, single[0]),
    };
  }
  return { minYears: null, maxYears: null, ...cited(false, null) };
}

function notice(text: string): Extracted["notice"] {
  const days = NOTICE_DAYS.exec(text);
  if (days) {
    const unit = days[2].toLowerCase().startsWith("month") ? 30 : 1;
    return { maxDays: Number(days[1]) * unit, ...cited(true, days[0]) };
  }
  const immediate = NOTICE_IMMEDIATE.exec(text);
  if (immediate) return { maxDays: 0, ...cited(true, immediate[0]) };
  return { maxDays: null, ...cited(false, null) };
}

function ctc(text: string): Extracted["ctc"] {
  const match = CTC.exec(text);
  if (!match) return { maxLpa: null, ...cited(false, null) };
  return { maxLpa: Number(match[2] ?? match[1]), ...cited(true, match[0]) };
}

const CITY_ALIASES: Record<string, string> = {
  gurgaon: "Gurugram",
  bangalore: "Bengaluru",
};
const CITY = new RegExp(
  String.raw`\b(new delhi|noida|gurugram|gurgaon|delhi|ncr|pune|bengaluru|bangalore|hyderabad|mumbai|chennai|kolkata)\b`,
  "gi",
);
const cityName = (raw: string) => {
  const key = raw.toLowerCase();
  if (CITY_ALIASES[key]) return CITY_ALIASES[key];
  return key === "ncr" ? "NCR" : key.replace(/\b\w/g, (c) => c.toUpperCase());
};

function locations(text: string): Extracted["locations"] {
  const line = LOCATION_LINE.exec(text);
  const listed = line
    ? line[1]
        .replace(/\([^)]*\)/g, "")
        .split(/,|\/|\bor\b|\band\b/i)
        .map((place) => place.trim().replace(/[.;]$/, ""))
        .filter(Boolean)
        .map((place) => CITY_ALIASES[place.toLowerCase()] ?? place)
    : [];
  const mentions = [...text.matchAll(CITY)];
  const unique = new Map<string, string>();
  for (const place of [...listed, ...mentions.map((m) => cityName(m[0]))]) {
    unique.set(place.toLowerCase(), place);
  }
  if (unique.size === 0) return { values: [], ...cited(false, null) };
  const quote =
    listed.length > 0
      ? line![0].trim()
      : sentenceAround(text, mentions[0].index);
  return { values: [...unique.values()], ...cited(true, quote) };
}

// Pattern matching cannot tell must-have from nice-to-have, so every skill found
// is a nice-to-have waiting for a person to decide.
export function rulesScorecard(jdText: string): Extracted {
  const criteria: CriterionView[] = findSkills(jdText)
    .slice(0, LIMITS.criteria)
    .map(({ name, index }) => ({
      kind: "NICE_TO_HAVE",
      label: name,
      ...cited(true, sentenceAround(jdText, index)),
    }));

  const result: Extracted = {
    title: null,
    criteria,
    experience: experience(jdText),
    notice: notice(jdText),
    ctc: ctc(jdText),
    locations: locations(jdText),
    ambiguities: [],
  };

  if (result.experience.minYears === null) {
    result.ambiguities.push("No experience range was found.");
  }
  if (result.notice.maxDays === null) {
    result.ambiguities.push("No notice period was found.");
  }
  if (result.ctc.maxLpa === null) {
    result.ambiguities.push("No CTC figure in LPA was found.");
  }
  if (result.locations.values.length === 0) {
    result.ambiguities.push("No location line was found.");
  }
  return result;
}
