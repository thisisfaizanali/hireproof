export type Layout =
  | "classic"
  | "sidebar"
  | "minimal"
  | "dense"
  | "fresher"
  | "table-indian"
  | "docx-classic";

export type DateStyle = "short" | "full" | "slash" | "apos";
export type Pool = "java" | "kyc" | "retail" | "none";
export type Fit = "strong" | "partial" | "poor";
export type DuplicateKind = "exact" | "contact" | "fuzzy";
export type Adversarial = "promptInjection" | "keywordStuffing";
export type ScanStrength = "clean" | "tilted" | "rough";

export const PERSONAL_FIELDS = [
  "dob",
  "age",
  "gender",
  "maritalStatus",
  "fatherName",
  "nationality",
  "languages",
] as const;
export type PersonalField = (typeof PERSONAL_FIELDS)[number];
export type Personal = Partial<Record<PersonalField, string>>;

export interface Role {
  title: string;
  company: string;
  city: string;
  /** Month the role began, "YYYY-MM". */
  start: string;
  /** Month the role ended, "YYYY-MM", or null when it is the current role. */
  end: string | null;
  bullets: string[];
}

export interface Education {
  degree: string;
  institute: string;
  year: string;
  score?: string;
}

export interface Candidate {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  city: string;
  currentRole: string;
  pool: Pool;
  /** JD key this CV is meant for, or null when it fits nothing. */
  requisition: string | null;
  fit: Fit;
  file: string;
  layout: Layout;
  dateStyle: DateStyle;
  roles: Role[];
  education: Education[];
  /** Skills exactly as written on the CV. */
  skills: string[];
  /** Skills as a scorer should normalise them. */
  canonicalSkills: string[];
  headline?: string;
  /** Free text under a "Summary" or "Objective" heading. */
  summary?: { label: string; text: string };
  /** Experience as the CV states it, when it states it at all. */
  statedExperience?: string;
  projects?: { name: string; desc: string }[];
  certifications?: string[];
  personal?: Personal;
  photo?: boolean;
  noticeText?: string;
  noticeDays: number | null;
  ctcText?: string;
  currentCtcLpa: number | null;
  expectedCtcLpa: number | null;
  scan?: ScanStrength;
  adversarial?: Adversarial;
  duplicate?: { group: string; kind: DuplicateKind };
}

export type JdBlock = { h: string } | { p: string } | { ul: string[] };

export interface Jd {
  key: string;
  file: string;
  format: "docx" | "pdf" | "txt";
  client: string;
  title: string;
  scorecard: {
    mustHave: string[];
    niceToHave: string[];
    experienceMinYears: number | null;
    experienceMaxYears: number | null;
    locations: string[];
    noticeMaxDays: number | null;
    ctcBudgetLpa: { min: number; max: number } | null;
  };
  /** What is deliberately missing or vague in the text. */
  ambiguity: string[];
  /** Structured body for docx and pdf. */
  blocks?: JdBlock[];
  /** Raw text for txt. */
  text?: string;
}
