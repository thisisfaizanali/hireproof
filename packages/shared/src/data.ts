import { z } from "zod";

// Consent is attested once per upload batch and stored against every CV in it.
export const CONSENT_NOTICE_VERSION = "2026-11";

export const CONSENT_BASIS_TEXT =
  "These candidates applied for this role or agreed to be considered for it.";

export const CONSENT_SOURCES = [
  ["JOB_PORTAL", "Job portal"],
  ["REFERRAL", "Referral"],
  ["DIRECT_APPLICATION", "Direct application"],
  ["AGENCY_DATABASE", "Agency database"],
  ["OTHER", "Other"],
] as const;

export const ConsentSource = z.enum([
  "JOB_PORTAL",
  "REFERRAL",
  "DIRECT_APPLICATION",
  "AGENCY_DATABASE",
  "OTHER",
]);
export type ConsentSource = z.infer<typeof ConsentSource>;

export const consentSourceLabel = (source: ConsentSource) =>
  CONSENT_SOURCES.find(([value]) => value === source)?.[1] ?? "Other";

export const ConsentInput = z
  .object(
    {
      basis: z.literal(true, {
        error: "Confirm that the candidates applied or agreed to be considered",
      }),
      source: ConsentSource,
      sourceNote: z
        .string()
        .trim()
        .max(200, "Keep the source under 200 characters")
        .optional(),
    },
    { error: "Record where these CVs came from before uploading" },
  )
  .superRefine((value, ctx) => {
    if (value.source === "OTHER" && !value.sourceNote) {
      ctx.addIssue({
        code: "custom",
        path: ["sourceNote"],
        message: "Say where the CVs came from",
      });
    }
  });
export type ConsentInput = z.infer<typeof ConsentInput>;

export interface ConsentView {
  cvId: string;
  fileName: string;
  source: ConsentSource;
  sourceNote: string | null;
  attestedBy: string;
  attestedAt: string;
  noticeVersion: string;
}

export const DELETION_REASONS = [
  ["CANDIDATE_REQUEST", "Candidate request"],
  ["RETENTION_ENDED", "Retention period ended"],
  ["UPLOADED_BY_MISTAKE", "Uploaded by mistake"],
] as const;

export const DeletionReason = z.enum([
  "CANDIDATE_REQUEST",
  "RETENTION_ENDED",
  "UPLOADED_BY_MISTAKE",
]);
export type DeletionReason = z.infer<typeof DeletionReason>;

export const deletionReasonLabel = (reason: DeletionReason) =>
  DELETION_REASONS.find(([value]) => value === reason)?.[1] ?? "Other";

export const DeleteCandidateInput = z.object({
  reason: DeletionReason,
  confirmCode: z.string().trim().min(1, "Type the candidate code to confirm"),
});
export type DeleteCandidateInput = z.infer<typeof DeleteCandidateInput>;

// What one erasure removed. Counts only.
export type DeletionCounts = {
  cvs: number;
  applications: number;
  scores: number;
  slots: number;
  messages: number;
  consentRecords: number;
  duplicateLinks: number;
};

export interface DeletionView {
  id: string;
  candidateCode: string;
  reason: DeletionReason;
  deletedBy: string;
  deletedAt: string;
  counts: DeletionCounts;
}

// A candidate is kept for 12 months after their last CV upload or stage change.
export const RETENTION_MONTHS = 12;

export function retainUntil(lastActivityAt: Date): Date {
  const until = new Date(lastActivityAt);
  until.setUTCMonth(until.getUTCMonth() + RETENTION_MONTHS);
  return until;
}

export interface RetentionRow {
  id: string;
  code: string;
  name: string;
  lastActivityAt: string;
  retainUntil: string;
}

export interface DataPage {
  expired: RetentionRow[];
  expiredTotal: number;
  deletions: DeletionView[];
}
