import { canonicalSkill, findSkills } from "@hireproof/shared";
import { joinSpacedHeadings } from "../cv/rules";
import type { RawVerdict } from "./evidence";

// "listed" is a skills list or the headline above the first heading, where a
// word is a label rather than something the candidate did.
type Section = "listed" | "education" | "other";

const HEADING =
  /^(summary|profile|objective|about|work experience|professional experience|experience|employment|projects?|education|academics?|qualifications?|certifications?|(?:technical |key )?skills?|core competenc(?:y|ies)|technologies|tools|achievements?|awards?|details|additional information|hobbies|interests?|references?|declaration|languages?(?: known)?|personal(?: details?)?)\b/i;

const sectionOf = (heading: string): Section =>
  /^(?:(?:technical |key )?skills?|core competenc|technologies|tools)/i.test(
    heading,
  )
    ? "listed"
    : /^(?:education|academics?|qualifications?|certifications?)/i.test(heading)
      ? "education"
      : "other";

// A heading is shouted ("EXPERIENCE", "S K I L L S") or short on its own line.
const isHeading = (line: string) =>
  HEADING.test(line) &&
  (/^[A-Z][A-Z &/]{2,}/.test(line) ||
    line.length <= 40 ||
    /^\w[\w ]*:/.test(line));

interface Line {
  text: string;
  section: Section;
}

function classify(text: string): Line[] {
  let section: Section = "listed";
  return text.split("\n").flatMap((raw) => {
    const head = joinSpacedHeadings(raw).trim();
    if (isHeading(head)) section = sectionOf(head);
    return raw.trim() ? [{ text: raw.trim(), section }] : [];
  });
}

// At most 25 words, centred on the match, so the quote reads as a quote.
function excerpt(line: string, index: number) {
  const words = line.split(/\s+/);
  if (words.length <= 25) return line;
  let at = 0;
  let seen = 0;
  for (; at < words.length; at++) {
    seen += words[at].length + 1;
    if (seen > index) break;
  }
  const start = Math.max(0, Math.min(at - 8, words.length - 25));
  return words.slice(start, start + 25).join(" ");
}

function skillOf(label: string) {
  const exact = canonicalSkill(label);
  if (exact) return exact;
  const found = findSkills(label);
  return found.length === 1 ? found[0].name : null;
}

// The score without the AI: a dictionary skill used in a role, project or
// summary line is MET, one that only sits in a skills list is PARTIAL, and
// anything else cannot be judged by pattern and is NOT_FOUND. The quote is the
// matched line, checked against the CV like any other.
export function rulesScore(
  criteria: { id: string; label: string }[],
  redactedText: string,
): RawVerdict[] {
  const lines = classify(redactedText);
  return criteria.map(({ id, label }) => {
    const skill = skillOf(label);
    if (!skill) return { id, verdict: "NOT_FOUND", quotes: [] };
    let listed: string | null = null;
    for (const line of lines) {
      if (line.section === "education") continue;
      const hit = findSkills(line.text).find((s) => s.name === skill);
      if (!hit) continue;
      const quote = excerpt(line.text, hit.index);
      if (line.section === "other") {
        return { id, verdict: "MET", quotes: [quote] };
      }
      listed ??= quote;
    }
    return listed
      ? { id, verdict: "PARTIAL", quotes: [listed] }
      : { id, verdict: "NOT_FOUND", quotes: [] };
  });
}
