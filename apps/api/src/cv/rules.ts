import { findSkills } from "@hireproof/shared";

export interface RulesProfile {
  email: string | null;
  phone: string | null;
  skills: string[];
  noticeText: string | null;
  noticeDays: number | null;
  ctcText: string | null;
  currentCtcLpa: number | null;
  expectedCtcLpa: number | null;
  statedExperienceYears: number | null;
  computedExperienceYears: number | null;
}

// PDF text often letter-spaces headings ("E X P E R I E N C E"). Join them so
// section headings can be recognised.
export function joinSpacedHeadings(text: string) {
  return text.replace(/\b(?:[A-Z]{1,3} ){3,}[A-Z]{1,3}\b/g, (run) => {
    const parts = run.split(" ");
    const singles = parts.filter((p) => p.length === 1).length;
    return singles >= 3 && singles / parts.length >= 0.6 ? parts.join("") : run;
  });
}

// Contact

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  const last = digits.slice(-10);
  return last.length === 10 && /^[6-9]/.test(last) ? last : null;
}

const EMAIL =
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/;
const PHONE =
  /(?<![\d.])(?:(?:\+|00)?91[\s.-]*)?0?([6-9]\d{4}[\s.-]?\d{5}|[6-9]\d{9})(?!\d)/g;

export function findEmail(text: string): string | null {
  const match = EMAIL.exec(text);
  return match ? normalizeEmail(match[0]) : null;
}

export function findPhone(text: string): string | null {
  for (const match of text.matchAll(PHONE)) {
    const phone = normalizePhone(match[1]);
    if (phone) return phone;
  }
  return null;
}

// Notice period

const NOTICE_UNITS: Record<string, number> = { day: 1, week: 7, month: 30 };

export function parseNotice(text: string): {
  noticeText: string | null;
  noticeDays: number | null;
} {
  // The unit has no trailing word boundary: hidden text can follow it directly.
  const numeric =
    /\b(?:notice(?:\s+period)?|np)\s*[:-]?\s*(\d+)\s*(day|week|month)s?(?:\s*\([^)\n]{1,40}\))?/i.exec(
      text,
    );
  if (numeric) {
    return {
      noticeText: numeric[0].trim(),
      noticeDays: Number(numeric[1]) * NOTICE_UNITS[numeric[2].toLowerCase()],
    };
  }
  const immediate =
    /\b(?:immediate(?:ly)?\s+joiner|immediate\s+joining|(?:available\s+(?:to\s+join\s+)?|can\s+join\s+)immediately)/i.exec(
      text,
    );
  if (immediate) return { noticeText: immediate[0].trim(), noticeDays: 0 };
  // Serving notice, a last working day or "negotiable" cannot become a number
  // without knowing today's date or the employer.
  const vague =
    /\b(?:serving\s+notice|notice(?:\s+period)?\s*[:-]|last\s+working\s+day|lwd)[^\n]{0,70}/i.exec(
      text,
    );
  return { noticeText: vague ? vague[0].trim() : null, noticeDays: null };
}

// CTC

const AMOUNT = String.raw`(?:₹|rs\.?|inr)?\s*(\d[\d,]*(?:\.\d+)?)\s*(lpa|lakhs?|lacs?|crores?|cr\b|l(?![a-z])|p\.?\s?a\b\.?)?`;
const EXPECTED = new RegExp(
  String.raw`expected(?:\s+ctc)?\s*[:-]?\s*${AMOUNT}`,
  "i",
);
const CURRENT_LABELLED = new RegExp(
  String.raw`(?<!expected\s)(?:(?:current|present|last\s+drawn|existing)\s+)?ctc\s*[:-]?\s*${AMOUNT}`,
  "i",
);
// "Current 7.5 LPA" has no CTC label, so it needs a unit to count.
const CURRENT_BARE = new RegExp(
  String.raw`(?<!expected\s)current\s*[:-]?\s*${AMOUNT}`,
  "i",
);

function toLpa(amount: string, unit: string | undefined, bare: boolean) {
  const value = Number(amount.replace(/,/g, ""));
  if (!Number.isFinite(value)) return null;
  const u = unit?.toLowerCase().replace(/[\s.]/g, "") ?? "";
  if (u.startsWith("cr")) return value * 100;
  if (u === "lpa" || u.startsWith("lakh") || u.startsWith("lac") || u === "l") {
    return value;
  }
  if (bare) return null;
  // Whole rupees, as in 14,50,000 or 1450000.
  if (value >= 100000) return Math.round((value / 100000) * 100) / 100;
  return value <= 200 ? value : null;
}

export function parseCtc(text: string): {
  ctcText: string | null;
  currentCtcLpa: number | null;
  expectedCtcLpa: number | null;
} {
  for (const line of text.split("\n")) {
    const spans: { start: number; end: number }[] = [];
    let current: number | null = null;
    let expected: number | null = null;

    const exp = EXPECTED.exec(line);
    if (exp) {
      expected = toLpa(exp[1], exp[2], false);
      if (expected !== null) {
        spans.push({ start: exp.index, end: exp.index + exp[0].length });
      }
    }
    for (const [pattern, bare] of [
      [CURRENT_LABELLED, false],
      [CURRENT_BARE, true],
    ] as const) {
      const match = pattern.exec(line);
      if (!match || current !== null) continue;
      current = toLpa(match[1], match[2], bare);
      if (current !== null) {
        spans.push({ start: match.index, end: match.index + match[0].length });
      }
    }
    if (spans.length > 0) {
      const start = Math.min(...spans.map((s) => s.start));
      const end = Math.max(...spans.map((s) => s.end));
      return {
        ctcText: line.slice(start, end).trim(),
        currentCtcLpa: current,
        expectedCtcLpa: expected,
      };
    }
  }
  return { ctcText: null, currentCtcLpa: null, expectedCtcLpa: null };
}

// Experience

const MONTHS = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
];

const MONTH_NAME = String.raw`(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?`;
const MONTH_YEAR = String.raw`(?:${MONTH_NAME}['’\s]*(?:\d{4}|\d{2})(?!\d)|\d{1,2}/\d{4})`;
const OPEN_END = String.raw`(?:present|current|till\s+date|to\s+date|till\s+now|ongoing|now)`;
const RANGE = new RegExp(
  String.raw`(?<![\d/])(${MONTH_YEAR})\s*(?:–|—|-|to|until)\s*(${MONTH_YEAR}|${OPEN_END})`,
  "gi",
);
const OPEN_END_ONLY = new RegExp(`^${OPEN_END}$`, "i");

const monthIndex = (year: number, month: number) => year * 12 + month;

function toMonthIndex(token: string): number | null {
  const slash = /^(\d{1,2})\/(\d{4})$/.exec(token);
  if (slash) {
    const month = Number(slash[1]);
    return month >= 1 && month <= 12
      ? monthIndex(Number(slash[2]), month - 1)
      : null;
  }
  const named = /^([a-z]+)\.?['’\s]*(\d{2,4})$/i.exec(token);
  if (!named) return null;
  const month = MONTHS.indexOf(named[1].slice(0, 3).toLowerCase());
  let year = Number(named[2]);
  if (month < 0) return null;
  if (year < 100) year += year >= 70 ? 1900 : 2000;
  return monthIndex(year, month);
}

const HEADING = /^[A-Z][A-Z &/,'-]{3,50}/;
const EDUCATION_HEADING =
  /^(?:EDUCATION|EDUCATIONAL QUALIFICATIONS?|ACADEMICS?|ACADEMIC QUALIFICATIONS?|QUALIFICATIONS?|CERTIFICATIONS?|COURSES?|TRAINING)\b/;
const DEGREE =
  /\b(?:b\.?\s?tech|m\.?\s?tech|b\.?e\.?|m\.?e\.?|b\.?sc|m\.?sc|b\.?com|m\.?com|bba|mba|bca|mca|diploma|ph\.?d|class\s+x{1,2}i{0,2}|ssc|hsc|cgpa|university|college|institute|school)\b/i;

// Years of work from dated ranges: each calendar month counts once, so
// overlapping roles are not double counted. A range runs from its first month
// up to, but not including, its last month; "Present" ends at today's month.
export function computeExperience(text: string, today: Date): number | null {
  const now = monthIndex(today.getUTCFullYear(), today.getUTCMonth());
  const months = new Set<number>();
  let inEducation = false;

  for (const rawLine of joinSpacedHeadings(text).split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const heading = HEADING.exec(line);
    if (heading) inEducation = EDUCATION_HEADING.test(heading[0].trim());
    if (inEducation || DEGREE.test(line)) continue;

    for (const match of line.matchAll(RANGE)) {
      const start = toMonthIndex(match[1]);
      const end = OPEN_END_ONLY.test(match[2]) ? now : toMonthIndex(match[2]);
      if (start === null || end === null) continue;
      for (let i = start; i < Math.min(end, now); i++) months.add(i);
    }
  }
  return months.size === 0 ? null : Math.round((months.size / 12) * 10) / 10;
}

const STATED = [
  /total\s+experience\s*[:-]?\s*(\d+(?:\.\d+)?)/i,
  /(\d+(?:\.\d+)?)\+?\s*(?:years?|yrs?)(?:\s+of)?\s+(?:[A-Za-z]+\s+){0,2}experience/i,
  /(\d+(?:\.\d+)?)\+?\s*(?:years?|yrs?)\s+(?:in|with)\b/i,
];

export function findStatedExperience(text: string): number | null {
  for (const pattern of STATED) {
    const match = pattern.exec(text);
    if (match) {
      const years = Number(match[1]);
      if (years >= 0 && years <= 45) return years;
    }
  }
  return null;
}

export function rulesProfile(text: string, today: Date): RulesProfile {
  return {
    email: findEmail(text),
    phone: findPhone(text),
    skills: findSkills(text).map((s) => s.name),
    ...parseNotice(text),
    ...parseCtc(text),
    statedExperienceYears: findStatedExperience(text),
    computedExperienceYears: computeExperience(text, today),
  };
}
