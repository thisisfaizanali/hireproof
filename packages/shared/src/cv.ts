import { z } from "zod";

export const CV_LIMITS = {
  fileBytes: 10 * 1024 * 1024,
  batchFiles: 500,
  requestFiles: 10,
} as const;

export const CvStatus = z.enum([
  "QUEUED",
  "EXTRACTING",
  "OCR",
  "PARSING",
  "PARSED",
  "NEEDS_REVIEW",
  "FAILED",
  "DUPLICATE_FILE",
]);
export type CvStatus = z.infer<typeof CvStatus>;

// A CV is finished once it is in one of these.
export const CV_FINAL_STATUSES: CvStatus[] = [
  "PARSED",
  "NEEDS_REVIEW",
  "FAILED",
  "DUPLICATE_FILE",
];

export const CreateBatchInput = z.object({
  expectedCount: z
    .number()
    .int("Enter a whole number")
    .min(1, "Add at least one file")
    .max(
      CV_LIMITS.batchFiles,
      `Upload at most ${CV_LIMITS.batchFiles} files at a time`,
    ),
});
export type CreateBatchInput = z.infer<typeof CreateBatchInput>;

export const ResolveDuplicateInput = z.object({ samePerson: z.boolean() });
export type ResolveDuplicateInput = z.infer<typeof ResolveDuplicateInput>;

export const DuplicateKind = z.enum(["EXACT_FILE", "CONTACT", "FUZZY"]);
export type DuplicateKind = z.infer<typeof DuplicateKind>;

export const DuplicateStatus = z.enum([
  "AUTO_MERGED",
  "PENDING",
  "SAME_PERSON",
  "DIFFERENT_PEOPLE",
]);
export type DuplicateStatus = z.infer<typeof DuplicateStatus>;

export type TextSource = "TEXT_LAYER" | "OCR";

export interface FileResult {
  fileName: string;
  accepted: boolean;
  cvId: string | null;
  reason: string | null;
}

export interface UploadFileView {
  id: string;
  fileName: string;
  sizeBytes: number;
  status: CvStatus;
  textSource: TextSource | null;
  reviewReasons: string[];
  failureReason: string | null;
  candidate: { id: string; code: string; name: string } | null;
  duplicate: { kind: DuplicateKind; reason: string } | null;
}

export interface UploadBatchView {
  id: string;
  requisitionId: string;
  expectedCount: number;
  createdAt: string;
  done: boolean;
  counts: Partial<Record<CvStatus, number>>;
  files: UploadFileView[];
}

export interface CandidateRow {
  id: string;
  code: string;
  name: string;
  currentRole: string | null;
  totalExperienceYears: number | null;
  noticeText: string | null;
  noticeDays: number | null;
  ctcText: string | null;
  location: string | null;
  skills: string[];
  stage: string;
  cvStatus: CvStatus | null;
  scanned: boolean;
  needsReview: boolean;
  possibleDuplicate: boolean;
}

export interface CandidateList {
  items: CandidateRow[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CandidateCv {
  id: string;
  fileName: string;
  sizeBytes: number;
  status: CvStatus;
  textSource: TextSource | null;
  ocrConfidence: number | null;
  parseSource: "AI" | "RULES" | null;
  reviewReasons: string[];
  failureReason: string | null;
  createdAt: string;
  requisition: { id: string; title: string };
}

export interface CandidateDuplicate {
  id: string;
  kind: DuplicateKind;
  status: DuplicateStatus;
  similarity: number | null;
  reason: string;
  fileName: string;
  other: { id: string; code: string; name: string };
  createdAt: string;
}

export interface CandidateDetail {
  id: string;
  code: string;
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
  createdAt: string;
  cvs: CandidateCv[];
  applications: {
    id: string;
    stage: string;
    requisition: { id: string; number: number; title: string };
  }[];
  duplicates: CandidateDuplicate[];
}

export interface DuplicateSide {
  id: string;
  code: string;
  name: string;
  email: string | null;
  phone: string | null;
  employers: string[];
  totalExperienceYears: number | null;
  currentRole: string | null;
}

export interface PendingDuplicate {
  id: string;
  kind: DuplicateKind;
  similarity: number | null;
  reason: string;
  fileName: string;
  requisitionId: string;
  incoming: DuplicateSide;
  existing: DuplicateSide;
}
