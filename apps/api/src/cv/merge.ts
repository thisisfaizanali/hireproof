import type { AiProfile } from "./aiProfile";
import { DEGREE, joinSpacedHeadings, type RulesProfile } from "./rules";

export interface CvProfile {
  name: string;
  email: string | null;
  phone: string | null;
  location: string | null;
  currentRole: string | null;
  totalExperienceYears: number | null;
  skills: string[];
  noticeText: string | null;
  noticeDays: number | null;
  ctcText: string | null;
  currentCtcLpa: number | null;
  expectedCtcLpa: number | null;
}

export interface Merged {
  profile: CvProfile;
  employers: string[];
  reviewReasons: string[];
  parseSource: "AI" | "RULES";
}

const squash = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

// The model reads a CV it cannot be trusted with, so anything it reports has to
// be visible in the text itself.
const appearsIn = (value: string, text: string) => {
  const needle = squash(value);
  return needle.length > 0 && ` ${squash(text)} `.includes(` ${needle} `);
};

const NOT_A_NAME =
  /\b(?:curriculum|vitae|resume|cv|contact|skills?|summary|profile|objective|about|experience|education|details|developer|engineer|analyst|manager|architect|designer|executive|officer|lead|consultant|specialist|supervisor|fresher|associate|intern|director|administrator|coordinator|technician|operations|banking|retail|stack|cloud|devops)\b/i;

const NAME_LINE = /^\p{Lu}[\p{L}.'-]*(?:\s+\p{Lu}[\p{L}.'-]*){1,3}$/u;

const EMAIL_RE =
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const PHONE_RE = /(?:(?:\+|00)?91[\s.-]*)?0?[6-9]\d{4}[\s.-]?\d{5}|[6-9]\d{9}/g;

const titleCase = (s: string) =>
  s === s.toUpperCase()
    ? s.toLowerCase().replace(/(^|[\s'-])\p{L}/gu, (m) => m.toUpperCase())
    : s;

// OCR sometimes leaves a stray one or two letter fragment beside the name.
const trimNoise = (name: string) => {
  const words = name.trim().split(/\s+/);
  return words
    .filter(
      (w, i) =>
        !(
          /^\p{L}{1,2}$/u.test(w) &&
          (i === 0 || i === words.length - 1) &&
          (words.length >= 3 || /^[a-z]/.test(w))
        ),
    )
    .join(" ");
};

// Fallback when the model is unavailable: a name is a short line of capitalised
// words near the top. When the email address shares a word with a line, that
// line wins, which settles layouts where the contact block comes first and the
// name sits further down.
export function guessName(text: string, email: string | null): string | null {
  const local = squash((email ?? "").split("@")[0]).replace(/ /g, "");
  const share = (line: string) =>
    squash(line)
      .split(" ")
      .filter((w) => w.length >= 3 && local.includes(w)).length;

  const lines = joinSpacedHeadings(text)
    .split("\n")
    .slice(0, 40)
    .map((raw, index) => {
      const before =
        raw.search(EMAIL_RE) > 0 ? raw.slice(0, raw.search(EMAIL_RE)) : raw;
      const line = trimNoise(
        before
          .replace(EMAIL_RE, " ")
          .replace(PHONE_RE, " ")
          .replace(/[|\u2018\u2019'"`]/g, " ")
          .replace(/\s+/g, " ")
          .trim(),
      );
      return { line, index };
    })
    .filter(
      ({ line }) =>
        line &&
        !/\d/.test(line) &&
        NAME_LINE.test(titleCase(line)) &&
        !NOT_A_NAME.test(line),
    );
  const best = [...lines].sort(
    (a, b) => share(b.line) - share(a.line) || a.index - b.index,
  )[0];
  // Without an email to confirm it, only the top of the page is trusted.
  if (!best || (share(best.line) === 0 && best.index > 5)) return null;
  return titleCase(best.line);
}

// First line of the role heading, as a rules-only guess: the text before the
// first comma on the first line that carries a date range.
export function guessRole(text: string): string | null {
  const line = text
    .split("\n")
    .find(
      (l) =>
        /\b(?:19|20)\d{2}\b.*(?:present|till date|to date|–|-|to)|\d{1,2}\/\d{4}\s*(?:to|-|–)/i.test(
          l,
        ) && /,/.test(l),
    );
  const role = line?.split(",")[0].trim();
  return role && role.length <= 60 && !/\d/.test(role) ? role : null;
}

export function guessLocation(text: string): string | null {
  const labelled = /\blocation\s*[:-]\s*([\p{L} ]{2,30})/iu.exec(text);
  if (labelled) return labelled[1].trim();
  const header = text
    .split("\n")
    .slice(0, 10)
    .find((l) => /@/.test(l) && /\|/.test(l));
  const last = header?.split("|").at(-1)?.trim();
  return last && /^\p{Lu}[\p{L} ]{2,25}$/u.test(last) ? last : null;
}

// Employer names for the duplicate comparison: the second comma-separated part
// of a role line that carries a date range, as in "Java Developer, Acme, Noida
// Jan 2020 - Present". Layouts that put employers in table cells give none.
export function findEmployers(text: string): string[] {
  const names = new Set<string>();
  for (const line of text.split("\n")) {
    if (DEGREE.test(line)) continue;
    if (!/\b(?:19|20)\d{2}\b|\d{1,2}\/\d{4}/.test(line)) continue;
    const parts = line.split(",");
    const name = parts.length >= 3 ? parts[1].trim() : "";
    if (/^\p{Lu}[\p{L}&.' -]{1,50}$/u.test(name)) names.add(name);
  }
  return [...names].slice(0, 5);
}

const yearsOk = (y: number | null | undefined): y is number =>
  typeof y === "number" && Number.isFinite(y) && y >= 0 && y <= 45;

export function mergeProfile(
  rules: RulesProfile,
  ai: AiProfile | null,
  text: string,
): Merged {
  const reasons: string[] = [];

  let name: string | null = null;
  let role: string | null = null;
  let location: string | null = null;
  let aiYears: number | null = null;
  if (ai) {
    if (ai.name && appearsIn(ai.name, text)) name = trimNoise(ai.name);
    else if (ai.name) {
      reasons.push("Check the name, the AI value was not found in the CV");
    }
    if (ai.currentRole && appearsIn(ai.currentRole, text)) {
      role = ai.currentRole.trim();
    }
    if (ai.location && appearsIn(ai.location, text)) {
      location = ai.location.trim();
    }
    if (yearsOk(ai.totalExperienceYears)) aiYears = ai.totalExperienceYears;
  } else {
    reasons.push("Parsed without AI, check name and role");
  }

  // A missing or rejected AI value falls back to the rules guess.
  name ??= guessName(text, rules.email);
  role ??= guessRole(text);
  location ??= guessLocation(text);
  if (!name) reasons.push("The candidate's name could not be found");
  if (!rules.email && !rules.phone) {
    reasons.push("No email or phone number was found");
  }

  const computed = rules.computedExperienceYears;
  const stated = rules.statedExperienceYears ?? aiYears;
  if (computed !== null && stated !== null && Math.abs(computed - stated) > 1) {
    reasons.push(
      `Experience from job dates (${computed} years) differs from the CV's own figure (${stated} years)`,
    );
  }
  const totalExperienceYears = computed ?? stated;

  if (rules.skills.length === 0 && totalExperienceYears === null) {
    reasons.push("No experience or skills were found, this may not be a CV");
  }

  return {
    employers: findEmployers(text),
    profile: {
      name: name ? titleCase(name) : "Unnamed candidate",
      email: rules.email,
      phone: rules.phone,
      location,
      currentRole: role,
      totalExperienceYears,
      skills: rules.skills,
      noticeText: rules.noticeText,
      noticeDays: rules.noticeDays,
      ctcText: rules.ctcText,
      currentCtcLpa: rules.currentCtcLpa,
      expectedCtcLpa: rules.expectedCtcLpa,
    },
    reviewReasons: reasons,
    parseSource: ai ? "AI" : "RULES",
  };
}
