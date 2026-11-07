import {
  AUDIT_ACTIONS,
  REJECT_REASONS,
  STAGE_NAME,
  clientRejectLabel,
  consentSourceLabel,
  deletionReasonLabel,
  type AuditAction,
  type Stage,
} from "@hireproof/shared";

export interface Described {
  action: string;
  // The person who acted, or null when nobody was signed in.
  person: string | null;
  meta: Record<string, unknown>;
  // Resolved from ids by the caller: CND-10137 and REQ-0009.
  candidate: string | null;
  requisition: string | null;
  // The user an event is about when that is not the actor: a failed sign-in
  // has no actor, but names the account that was tried.
  target?: string | null;
}

const text = (v: unknown) => (typeof v === "string" ? v : "");
const lower = (s: string) => s.toLowerCase().replaceAll("_", " ");
// STAGE_NAME reads after "is"; here a stage follows "from" and "to".
const STAGE_IN_A_SENTENCE: Partial<Record<Stage, string>> = {
  INTERVIEW: "interview",
  CLIENT_SHORTLISTED: "shortlisted",
};
const stage = (v: unknown) =>
  STAGE_IN_A_SENTENCE[text(v) as Stage] ??
  STAGE_NAME[text(v) as Stage] ??
  lower(text(v));

const BAND_NAME: Record<string, string> = {
  STRONG: "a strong match",
  POSSIBLE: "a possible match",
  WEAK: "a weak match",
};
const bandNote = (m: Record<string, unknown>) =>
  BAND_NAME[text(m.band)]
    ? `, which the AI scored as ${BAND_NAME[text(m.band)]}`
    : "";

const rejectReason = (v: unknown) =>
  REJECT_REASONS.find(([code]) => code === v)?.[1] ?? "Other";

type Case = (d: Described, who: string, cand: string, req: string) => string;

const CASES: Record<AuditAction, Case> = {
  LOGIN_SUCCEEDED: (_d, who) => `${who} signed in`,
  LOGIN_FAILED: (d) =>
    d.target
      ? `Failed sign-in to ${d.target}'s account`
      : "Failed sign-in with an unknown email",
  LOGOUT: (_d, who) => `${who} signed out`,
  REQUISITION_CREATED: (_d, who, _c, req) => `${who} created ${req}`,
  REQUISITION_STATUS_CHANGED: (d, who, _c, req) =>
    `${who} changed ${req} from ${lower(text(d.meta.from))} to ${lower(text(d.meta.to))}`,
  SCORECARD_EXTRACTED: (d, _w, _c, req) =>
    `The scorecard for ${req} was drafted by ${d.meta.source === "AI" ? "AI" : "pattern matching"}`,
  SCORECARD_CONFIRMED: (d, who, _c, req) =>
    `${who} confirmed version ${text(String(d.meta.version ?? ""))} of the scorecard for ${req}`,
  UPLOAD_CONSENT_RECORDED: (d, who, _c, req) =>
    `${who} recorded the basis for holding CVs uploaded to ${req}, source ${consentSourceLabel(text(d.meta.source) as never).toLowerCase()}`,
  CANDIDATE_PROFILE_VIEWED: (_d, who, cand) =>
    `${who} opened the profile of ${cand}`,
  CV_VIEWED: (_d, who, cand, req) =>
    `${who} opened the CV of ${cand} for ${req}`,
  DUPLICATE_RESOLVED: (d, who) =>
    `${who} decided two CVs belong to ${d.meta.samePerson ? "the same person" : "different people"}`,
  APPLICATION_SCREENED: (d, who, cand, req) =>
    `${who} marked ${cand} screened for ${req}${bandNote(d.meta)}`,
  APPLICATION_REJECTED: (d, who, cand, req) =>
    `${who} marked ${cand} not a fit for ${req}, reason: ${rejectReason(d.meta.reason).toLowerCase()}${bandNote(d.meta)}`,
  APPLICATION_REOPENED: (_d, who, cand, req) =>
    `${who} reopened ${cand} for ${req}`,
  APPLICATION_SUBMITTED: (d, who, cand, req) =>
    `${who} submitted ${cand} to the client for ${req}${bandNote(d.meta)}`,
  SUBMISSION_WITHDRAWN: (_d, who, cand, req) =>
    `${who} withdrew the submission of ${cand} for ${req}`,
  CLIENT_CANDIDATE_VIEWED: (_d, who, cand, req) =>
    `${who} opened ${cand} for ${req}`,
  CLIENT_SHORTLISTED: (_d, who, cand, req) =>
    `${who} shortlisted ${cand} for ${req}`,
  CLIENT_REJECTED: (d, who, cand, req) =>
    `${who} rejected ${cand} for ${req}, reason: ${clientRejectLabel(text(d.meta.reason) as never).toLowerCase()}`,
  SLOT_PROPOSED: (d, who, cand, req) =>
    `${who} proposed ${Number(d.meta.slots) || 1} interview time${Number(d.meta.slots) === 1 ? "" : "s"} for ${cand} on ${req}`,
  SLOT_CONFIRMED: (_d, who, cand, req) =>
    `${who} confirmed an interview time for ${cand} on ${req}`,
  SLOTS_DECLINED: (_d, who, cand, req) =>
    `${who} declined the proposed times for ${cand} on ${req}`,
  STAGE_CHANGED: (d, who, cand, req) =>
    `${who} moved ${cand} on ${req} from ${stage(d.meta.from)} to ${stage(d.meta.to)}`,
  MESSAGE_RECORDED: (d, _w, cand, req) =>
    `A message to the ${lower(text(d.meta.recipient))} about ${cand} on ${req} was recorded, not sent`,
  SAMPLE_REVIEWED: (d, who, cand, req) =>
    `${who} reviewed ${cand} on ${req} in the sample for the week of ${text(d.meta.weekStart)}`,
  CANDIDATE_DELETED: (d, who) =>
    `${who} deleted all data held on ${text(d.meta.code)}, reason: ${deletionReasonLabel(text(d.meta.reason) as never).toLowerCase()}`,
};

// The one place an audit event becomes a sentence. Every action in
// AUDIT_ACTIONS has a case, which the type enforces.
export function describe(d: Described): string {
  const who = d.person ?? "Someone";
  const cand = d.candidate ?? "a candidate who has since been deleted";
  const req = d.requisition ?? "a requisition";
  const make = (CASES as Record<string, Case | undefined>)[d.action];
  return make
    ? make(d, who, cand, req)
    : ((AUDIT_ACTIONS as Record<string, string>)[d.action] ?? d.action);
}
