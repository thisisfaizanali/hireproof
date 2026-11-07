import { z } from "zod";
import type { Role } from "./index";
import type { Band, Verdict } from "./score";

export const Stage = z.enum([
  "SOURCED",
  "SCREENED",
  "SUBMITTED",
  "CLIENT_SHORTLISTED",
  "INTERVIEW",
  "OFFERED",
  "JOINED",
  "REJECTED",
  "WITHDRAWN",
]);
export type Stage = z.infer<typeof Stage>;

// The strip above the recruiter's list, in pipeline order.
export const STAGE_STRIP: readonly (readonly [Stage, string])[] = [
  ["SOURCED", "Sourced"],
  ["SCREENED", "Screened"],
  ["SUBMITTED", "Submitted"],
  ["CLIENT_SHORTLISTED", "Shortlisted"],
  ["INTERVIEW", "Interview"],
  ["OFFERED", "Offered"],
  ["JOINED", "Joined"],
  ["REJECTED", "Rejected"],
];

// Every move between stages, by who may make it. The one place that decides.
const MOVES: Record<Role, readonly (readonly [Stage, Stage])[]> = {
  RECRUITER: [
    ["SOURCED", "SCREENED"],
    ["SOURCED", "REJECTED"],
    ["SCREENED", "REJECTED"],
    ["REJECTED", "SOURCED"],
    ["SCREENED", "SUBMITTED"],
    ["SUBMITTED", "WITHDRAWN"],
    ["CLIENT_SHORTLISTED", "INTERVIEW"],
    ["INTERVIEW", "OFFERED"],
    ["INTERVIEW", "REJECTED"],
    ["OFFERED", "JOINED"],
    ["OFFERED", "WITHDRAWN"],
  ],
  CLIENT_HM: [
    ["SUBMITTED", "CLIENT_SHORTLISTED"],
    ["SUBMITTED", "REJECTED"],
  ],
  DELIVERY_HEAD: [],
};

export const canMove = (from: Stage, to: Stage, role: Role) =>
  MOVES[role].some(([a, b]) => a === from && b === to);

// The stages a recruiter moves by hand once the client has chosen.
export const PIPELINE_FROM: readonly Stage[] = ["INTERVIEW", "OFFERED"];

export const MoveInput = z.object({
  to: z.enum(["OFFERED", "JOINED", "REJECTED", "WITHDRAWN"], {
    error: "Choose where to move this candidate",
  }),
});
export type MoveInput = z.infer<typeof MoveInput>;

export const NOTE_LIMITS = { min: 20, max: 600 } as const;

export const SubmitInput = z.object({
  note: z
    .string()
    .trim()
    .min(
      NOTE_LIMITS.min,
      `Write at least ${NOTE_LIMITS.min} characters on why this candidate`,
    )
    .max(NOTE_LIMITS.max, `Keep the note under ${NOTE_LIMITS.max} characters`),
});
export type SubmitInput = z.infer<typeof SubmitInput>;

export const CLIENT_REJECT_REASONS = [
  ["SKILLS_GAP", "Skills gap"],
  ["EXPERIENCE", "Experience"],
  ["NOTICE_PERIOD", "Notice period"],
  ["CTC", "Compensation"],
  ["LOCATION", "Location"],
  ["ALREADY_INTERVIEWED", "Already interviewed"],
  ["OTHER", "Other"],
] as const;

export const ClientRejectReason = z.enum([
  "SKILLS_GAP",
  "EXPERIENCE",
  "NOTICE_PERIOD",
  "CTC",
  "LOCATION",
  "ALREADY_INTERVIEWED",
  "OTHER",
]);
export type ClientRejectReason = z.infer<typeof ClientRejectReason>;

export const clientRejectLabel = (reason: ClientRejectReason | null) =>
  CLIENT_REJECT_REASONS.find(([value]) => value === reason)?.[1] ?? "Other";

export const ClientRejectInput = z
  .object({
    reason: ClientRejectReason,
    note: z
      .string()
      .trim()
      .max(500, "Keep the note under 500 characters")
      .optional(),
  })
  .superRefine((value, ctx) => {
    if (value.reason === "OTHER" && !value.note) {
      ctx.addIssue({
        code: "custom",
        path: ["note"],
        message: "Say why in a few words",
      });
    }
  });
export type ClientRejectInput = z.infer<typeof ClientRejectInput>;

// Interview times. India has no daylight saving, so IST is a fixed +05:30 and
// a time the client types is read in IST wherever the server runs.
const IST_OFFSET_MS = 330 * 60_000;
const IST_LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

export const SLOT_MINUTES = [30, 45, 60] as const;
export const SLOT_MODES = [
  ["VIDEO", "Video"],
  ["IN_PERSON", "In person"],
] as const;
const DAY_START = 9 * 60;
const DAY_END = 19 * 60;

// "2026-11-09T10:30", as a date input gives it, read as IST.
export function parseIst(local: string): Date | null {
  const m = IST_LOCAL.exec(local);
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const wall = new Date(Date.UTC(y, mo - 1, d, h, mi));
  if (
    wall.getUTCFullYear() !== y ||
    wall.getUTCMonth() !== mo - 1 ||
    wall.getUTCDate() !== d ||
    h > 23 ||
    mi > 59
  ) {
    return null;
  }
  return new Date(wall.getTime() - IST_OFFSET_MS);
}

const istWall = (date: Date) => new Date(date.getTime() + IST_OFFSET_MS);

export function checkSlotTime(
  startsAt: string,
  durationMinutes: number,
  now: Date,
): string | null {
  const at = parseIst(startsAt);
  if (!at) return "Enter a date and time";
  if (at.getTime() <= now.getTime()) return "Choose a time in the future";
  const wall = istWall(at);
  const day = wall.getUTCDay();
  if (day === 0 || day === 6) return "Choose a weekday";
  const start = wall.getUTCHours() * 60 + wall.getUTCMinutes();
  if (start < DAY_START || start + durationMinutes > DAY_END) {
    return "Choose a time between 9:00 and 19:00 IST";
  }
  return null;
}

export const SlotInput = z.object({
  startsAt: z.string().min(1, "Enter a date and time"),
  durationMinutes: z
    .number()
    .refine(
      (n) => (SLOT_MINUTES as readonly number[]).includes(n),
      "Choose 30, 45 or 60 minutes",
    ),
  mode: z.enum(["VIDEO", "IN_PERSON"], { error: "Choose video or in person" }),
  note: z
    .string()
    .trim()
    .max(200, "Keep the note under 200 characters")
    .optional(),
});
export type SlotInput = z.infer<typeof SlotInput>;

export const ProposeSlotsInput = (now: Date = new Date()) =>
  z
    .object({
      slots: z
        .array(SlotInput)
        .min(1, "Add at least one time")
        .max(3, "Propose at most three times"),
    })
    .superRefine((value, ctx) => {
      const seen = new Set<string>();
      value.slots.forEach((slot, i) => {
        const problem = checkSlotTime(slot.startsAt, slot.durationMinutes, now);
        if (problem) {
          ctx.addIssue({
            code: "custom",
            path: ["slots", i, "startsAt"],
            message: problem,
          });
        } else if (seen.has(slot.startsAt)) {
          ctx.addIssue({
            code: "custom",
            path: ["slots", i, "startsAt"],
            message: "Each time must be different",
          });
        }
        seen.add(slot.startsAt);
      });
    });
export type ProposeSlotsInput = z.infer<ReturnType<typeof ProposeSlotsInput>>;

export function formatIst(iso: string) {
  const text = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(iso));
  return `${text} IST`;
}

export type SlotMode = "VIDEO" | "IN_PERSON";
export type SlotStatus = "PROPOSED" | "CONFIRMED" | "DECLINED";

export const slotModeLabel = (mode: SlotMode) =>
  mode === "VIDEO" ? "Video" : "In person";

export interface SlotView {
  id: string;
  startsAt: string;
  durationMinutes: number;
  mode: SlotMode;
  note: string | null;
  status: SlotStatus;
}

export interface MessageView {
  id: string;
  recipient: "CANDIDATE" | "CLIENT";
  subject: string;
  body: string;
  createdAt: string;
}

export interface ClientRejection {
  reason: ClientRejectReason;
  note: string | null;
}

// The client's side of the pipeline. Nothing here is a contact detail, the
// 0 to 100 total, or anything about another client.
export interface PortalCounts {
  submitted: number;
  awaitingReview: number;
  shortlisted: number;
  interviews: number;
}

export interface PortalRequisition {
  id: string;
  number: number;
  title: string;
  status: string;
  counts: PortalCounts;
}

export interface PortalCandidateRow {
  applicationId: string;
  code: string;
  name: string;
  currentRole: string | null;
  totalExperienceYears: number | null;
  noticeText: string | null;
  noticeDays: number | null;
  location: string | null;
  stage: Stage;
  submittedAt: string;
  band: Band | null;
  mustHavesMet: number;
  mustHavesTotal: number;
  flags: string[];
  rejection: ClientRejection | null;
  slots: SlotView[];
}

export interface PortalCandidateList {
  requisition: { id: string; number: number; title: string; status: string };
  counts: PortalCounts;
  items: PortalCandidateRow[];
}

export interface PortalCriterion {
  label: string;
  kind: "MUST_HAVE" | "NICE_TO_HAVE";
  verdict: Verdict;
  quotes: string[];
}

export interface PortalApplication extends PortalCandidateRow {
  requisition: { id: string; number: number; title: string };
  skills: string[];
  note: string;
  criteria: PortalCriterion[];
  cvText: string | null;
}

export const STAGE_NAME: Record<Stage, string> = {
  SOURCED: "sourced",
  SCREENED: "screened",
  SUBMITTED: "submitted",
  CLIENT_SHORTLISTED: "shortlisted by the client",
  INTERVIEW: "at interview",
  OFFERED: "offered",
  JOINED: "joined",
  REJECTED: "rejected",
  WITHDRAWN: "withdrawn",
};
