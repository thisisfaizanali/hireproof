// Three tiers, strongest first. The first two are certain enough to attach the
// CV to the existing candidate on their own. The third is a guess, so it only
// asks a recruiter to look.
export type DuplicateKind = "EXACT_FILE" | "CONTACT" | "FUZZY";

export interface KnownCandidate {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  fileHashes: string[];
  texts: string[];
}

export interface IncomingCv {
  sha256: string;
  name: string;
  email: string | null;
  phone: string | null;
  text: string;
}

export interface DuplicateMatch {
  kind: DuplicateKind;
  candidateId: string;
  similarity: number | null;
  reason: string;
}

// Tuned on the sample corpus: the genuine fuzzy pair scores 0.71, and the most
// similar pair of different people scores 0.18.
export const FUZZY_THRESHOLD = 0.5;

const SHINGLE_WORDS = 3;

export const normalizeName = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^\p{L}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(" ");

export const surname = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^\p{L}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .at(-1) ?? "";

function shingles(text: string) {
  const words = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  const set = new Set<string>();
  for (let i = 0; i + SHINGLE_WORDS <= words.length; i++) {
    set.add(words.slice(i, i + SHINGLE_WORDS).join(" "));
  }
  return set;
}

// Share of three-word phrases the two texts have in common.
export function similarity(a: string, b: string): number {
  const x = shingles(a);
  const y = shingles(b);
  if (x.size === 0 || y.size === 0) return 0;
  let shared = 0;
  for (const s of x) if (y.has(s)) shared++;
  return shared / (x.size + y.size - shared);
}

export function findDuplicate(
  cv: IncomingCv,
  known: KnownCandidate[],
): DuplicateMatch | null {
  const sameFile = known.find((k) => k.fileHashes.includes(cv.sha256));
  if (sameFile) {
    return {
      kind: "EXACT_FILE",
      candidateId: sameFile.id,
      similarity: 1,
      reason: "The same file was uploaded before",
    };
  }

  const byEmail =
    cv.email && known.find((k) => k.email && k.email === cv.email);
  if (byEmail) {
    return {
      kind: "CONTACT",
      candidateId: byEmail.id,
      similarity: null,
      reason: "Same email address",
    };
  }
  const byPhone =
    cv.phone && known.find((k) => k.phone && k.phone === cv.phone);
  if (byPhone) {
    return {
      kind: "CONTACT",
      candidateId: byPhone.id,
      similarity: null,
      reason: "Same phone number",
    };
  }

  const name = normalizeName(cv.name);
  if (!name) return null;
  let best: DuplicateMatch | null = null;
  for (const k of known) {
    if (normalizeName(k.name) !== name) continue;
    for (const text of k.texts) {
      const score = similarity(cv.text, text);
      if (score >= FUZZY_THRESHOLD && score > (best?.similarity ?? 0)) {
        best = {
          kind: "FUZZY",
          candidateId: k.id,
          similarity: Math.round(score * 100) / 100,
          reason: "Same name and a very similar CV",
        };
      }
    }
  }
  return best;
}
