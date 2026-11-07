import {
  clientRejectLabel,
  formatIst,
  slotModeLabel,
  type PortalCandidateRow,
  type SlotView,
  type Stage,
} from "@hireproof/shared";

// What the client sees of a stage, in their words.
export const PORTAL_STAGE: Record<string, string> = {
  SUBMITTED: "Awaiting your review",
  CLIENT_SHORTLISTED: "Shortlisted",
  INTERVIEW: "Interview",
  OFFERED: "Offered",
  JOINED: "Joined",
  REJECTED: "Rejected",
};

const ALL: Stage[] = [
  "SUBMITTED",
  "CLIENT_SHORTLISTED",
  "INTERVIEW",
  "OFFERED",
  "JOINED",
  "REJECTED",
];

export const PORTAL_FILTERS: {
  key: string;
  label: string;
  stages: Stage[];
}[] = [
  { key: "awaiting", label: "Awaiting review", stages: ["SUBMITTED"] },
  { key: "shortlisted", label: "Shortlisted", stages: ["CLIENT_SHORTLISTED"] },
  {
    key: "interviews",
    label: "Interviews and offers",
    stages: ["INTERVIEW", "OFFERED", "JOINED"],
  },
  { key: "rejected", label: "Rejected", stages: ["REJECTED"] },
  { key: "all", label: "All", stages: ALL },
];

export function stageText(
  row: Pick<PortalCandidateRow, "stage" | "rejection">,
) {
  if (row.stage === "REJECTED" && row.rejection) {
    return `Rejected: ${clientRejectLabel(row.rejection.reason)}`;
  }
  return PORTAL_STAGE[row.stage] ?? row.stage;
}

// "Notice 60 days", "Notice immediate", or the CV's own words when they are
// not a number of days.
export function noticePhrase(text: string | null, days: number | null) {
  if (days === null) return text ? `notice: ${text}` : "notice not stated";
  return days === 0 ? "notice immediate" : `notice ${days} days`;
}

export const slotText = (s: SlotView) =>
  `${formatIst(s.startsAt)}, ${s.durationMinutes} minutes, ${slotModeLabel(s.mode).toLowerCase()}`;

export const SLOT_STATUS: Record<SlotView["status"], string> = {
  PROPOSED: "Proposed",
  CONFIRMED: "Confirmed",
  DECLINED: "Declined",
};

export const CONTACT_NOTE =
  "Contact details are shared by your Hireproof recruiter.";
