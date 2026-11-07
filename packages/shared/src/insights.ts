import { z } from "zod";
import type { AiOutcome } from "./scorecard";
import { parseIst } from "./pipeline";
import type { Band } from "./score";

// Weeks run Monday 00:00 to Sunday 23:59 IST. A week is named by its Monday.
const IST_OFFSET_MS = 330 * 60_000;

export function addDays(day: string, n: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + n);
  return date.toISOString().slice(0, 10);
}

export function weekStartOf(at: Date): string {
  const wall = new Date(at.getTime() + IST_OFFSET_MS);
  wall.setUTCDate(wall.getUTCDate() - ((wall.getUTCDay() + 6) % 7));
  return wall.toISOString().slice(0, 10);
}

const isMonday = (day: string) => {
  const date = new Date(`${day}T00:00:00Z`);
  return (
    !Number.isNaN(date.getTime()) &&
    date.toISOString().startsWith(day) &&
    date.getUTCDay() === 1
  );
};

export const WeekStart = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a week")
  .refine(isMonday, "A week starts on a Monday");

// The instants a week covers: from Monday 00:00 IST up to, not including, the
// next Monday.
export function weekRange(start: string) {
  return {
    from: parseIst(`${start}T00:00`)!,
    to: parseIst(`${addDays(start, 7)}T00:00`)!,
  };
}

export const formatWeek = (start: string) => {
  const fmt = (day: string) =>
    new Date(`${day}T00:00:00Z`).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    });
  const end = addDays(start, 6);
  const year = end.slice(0, 4);
  return `${fmt(start)} to ${fmt(end)} ${year}`;
};

export type DecisionBand = Band | "NOT_SCORED";

export const DECISION_BANDS: readonly DecisionBand[] = [
  "STRONG",
  "POSSIBLE",
  "WEAK",
  "NOT_SCORED",
];

// What a person did that the AI's band can be set beside.
export const DECISION_ACTIONS = [
  "APPLICATION_SCREENED",
  "APPLICATION_REJECTED",
  "APPLICATION_SUBMITTED",
  "CLIENT_SHORTLISTED",
  "CLIENT_REJECTED",
] as const;
export type DecisionAction = (typeof DECISION_ACTIONS)[number];

export const DECISION_LABEL: Record<DecisionAction, string> = {
  APPLICATION_SCREENED: "Screened",
  APPLICATION_REJECTED: "Not a fit",
  APPLICATION_SUBMITTED: "Submitted",
  CLIENT_SHORTLISTED: "Shortlisted by the client",
  CLIENT_REJECTED: "Rejected by the client",
};

export interface AgreementRow {
  band: DecisionBand;
  screened: number;
  rejected: number;
  submitted: number;
  shortlisted: number;
  clientRejected: number;
}

export interface Disagreement {
  applicationId: string;
  candidateId: string;
  candidateCode: string;
  requisitionId: string;
  requisitionNumber: number;
  band: Band;
  total: number | null;
  action: DecisionAction;
  reason: string | null;
  by: string;
  at: string;
  cvId: string | null;
}

export const SAMPLE_VERDICTS = [
  ["AI_RIGHT", "AI was right"],
  ["RECRUITER_RIGHT", "Recruiter was right"],
  ["BOTH_REASONABLE", "Both reasonable"],
] as const;

export const SampleVerdict = z.enum([
  "AI_RIGHT",
  "RECRUITER_RIGHT",
  "BOTH_REASONABLE",
]);
export type SampleVerdict = z.infer<typeof SampleVerdict>;

export const SAMPLE_SIZE = 10;

export const SampleReviewInput = z.object({
  weekStart: WeekStart,
  verdict: SampleVerdict,
  note: z
    .string()
    .trim()
    .max(500, "Keep the note under 500 characters")
    .optional(),
});
export type SampleReviewInput = z.infer<typeof SampleReviewInput>;

export interface SampleItem {
  applicationId: string;
  candidateId: string;
  candidateCode: string;
  requisitionId: string;
  requisitionNumber: number;
  band: Band;
  total: number | null;
  action: DecisionAction;
  reason: string | null;
  disagreement: boolean;
  cvId: string | null;
  review: { verdict: SampleVerdict; note: string | null } | null;
}

export interface Overlap {
  requisitionId: string;
  number: number;
  title: string;
  topSize: number;
  screenedInTop: number;
  // Screened candidates the AI did not place in its top ten.
  outside: { id: string; code: string }[];
}

export interface AiHealth {
  scoresBySource: { AI: number; RULES: number };
  runs: { kind: string; outcome: AiOutcome; count: number }[];
  inputTokens: number;
  outputTokens: number;
  quotes: { total: number; verified: number };
  downgrades: number;
  reviewReasons: number;
}

export interface Funnel {
  sourced: number;
  screened: number;
  submitted: number;
  shortlisted: number;
  interview: number;
  offered: number;
  joined: number;
}

export interface WeekInsights {
  weekStart: string;
  thisWeek: string;
  agreement: {
    rows: AgreementRow[];
    agreed: number;
    compared: number;
  };
  disagreements: Disagreement[];
  sample: {
    items: SampleItem[];
    reviewed: number;
    tally: Record<SampleVerdict, number>;
  };
  overlap: Overlap[];
  health: AiHealth;
  funnel: Funnel;
}

// Every action the audit log can hold, with the short name used in filters.
export const AUDIT_ACTIONS = {
  LOGIN_SUCCEEDED: "Signed in",
  LOGIN_FAILED: "Failed sign in",
  LOGOUT: "Signed out",
  REQUISITION_CREATED: "Requisition created",
  REQUISITION_STATUS_CHANGED: "Requisition status changed",
  SCORECARD_EXTRACTED: "Scorecard drafted",
  SCORECARD_CONFIRMED: "Scorecard confirmed",
  UPLOAD_CONSENT_RECORDED: "Consent recorded for an upload",
  CANDIDATE_PROFILE_VIEWED: "Candidate profile opened",
  CV_VIEWED: "CV opened",
  DUPLICATE_RESOLVED: "Duplicate resolved",
  APPLICATION_SCREENED: "Screened",
  APPLICATION_REJECTED: "Marked not a fit",
  APPLICATION_REOPENED: "Reopened",
  APPLICATION_SUBMITTED: "Submitted to the client",
  SUBMISSION_WITHDRAWN: "Submission withdrawn",
  CLIENT_CANDIDATE_VIEWED: "Client opened a candidate",
  CLIENT_SHORTLISTED: "Client shortlisted",
  CLIENT_REJECTED: "Client rejected",
  SLOT_PROPOSED: "Interview times proposed",
  SLOT_CONFIRMED: "Interview time confirmed",
  SLOTS_DECLINED: "Interview times declined",
  STAGE_CHANGED: "Stage changed",
  MESSAGE_RECORDED: "Message recorded",
  SAMPLE_REVIEWED: "Weekly sample reviewed",
  CANDIDATE_DELETED: "Candidate data deleted",
} as const;
export type AuditAction = keyof typeof AUDIT_ACTIONS;

export const AuditQuery = z.object({
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  person: z.string().trim().min(1).max(64).optional(),
  action: z
    .string()
    .refine((a) => a in AUDIT_ACTIONS, "Unknown action")
    .optional(),
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  // A candidate code (CND-10137) or a requisition number (REQ-0009).
  subject: z.string().trim().max(40).optional(),
});
export type AuditQuery = z.infer<typeof AuditQuery>;

export interface AuditRowView {
  id: string;
  at: string;
  person: string | null;
  sentence: string;
  ip: string | null;
}

export interface AuditPageView {
  rows: AuditRowView[];
  total: number;
  page: number;
  pageSize: number;
  people: { id: string; name: string }[];
  // Set when the subject filter named something that does not exist.
  subjectNote: string | null;
}
