import {
  DECISION_BANDS,
  SAMPLE_SIZE,
  type AgreementRow,
  type DecisionAction,
  type DecisionBand,
} from "@hireproof/shared";

// One decision a person made, with the AI's band at that moment.
export interface Decision {
  applicationId: string;
  action: DecisionAction;
  band: DecisionBand;
  at: Date;
}

const COLUMN: Record<DecisionAction, keyof Omit<AgreementRow, "band">> = {
  APPLICATION_SCREENED: "screened",
  APPLICATION_REJECTED: "rejected",
  APPLICATION_SUBMITTED: "submitted",
  CLIENT_SHORTLISTED: "shortlisted",
  CLIENT_REJECTED: "clientRejected",
};

// The recruiter and the AI agree when a Strong or Possible match is screened
// or a Weak match is turned down.
export const agrees = (d: Pick<Decision, "action" | "band">) =>
  (d.action === "APPLICATION_SCREENED" &&
    (d.band === "STRONG" || d.band === "POSSIBLE")) ||
  (d.action === "APPLICATION_REJECTED" && d.band === "WEAK");

// A Strong match turned down, or a Weak match that someone moved forward.
export const disagrees = (d: Pick<Decision, "action" | "band">) =>
  (d.band === "STRONG" && d.action === "APPLICATION_REJECTED") ||
  (d.band === "WEAK" &&
    (d.action === "APPLICATION_SCREENED" ||
      d.action === "APPLICATION_SUBMITTED" ||
      d.action === "CLIENT_SHORTLISTED"));

export function agreementTable(decisions: Pick<Decision, "action" | "band">[]) {
  const rows: AgreementRow[] = DECISION_BANDS.map((band) => ({
    band,
    screened: 0,
    rejected: 0,
    submitted: 0,
    shortlisted: 0,
    clientRejected: 0,
  }));
  let agreed = 0;
  let compared = 0;
  for (const d of decisions) {
    rows.find((r) => r.band === d.band)![COLUMN[d.action]]++;
    const recruiterScreening =
      d.action === "APPLICATION_SCREENED" ||
      d.action === "APPLICATION_REJECTED";
    if (recruiterScreening && d.band !== "NOT_SCORED") compared++;
    if (agrees(d)) agreed++;
  }
  return { rows, agreed, compared };
}

const BAND_RANK = { STRONG: 0, POSSIBLE: 1, WEAK: 2 } as const;

export interface RankedApplication {
  id: string;
  candidateId: string;
  code: string;
  score: {
    band: keyof typeof BAND_RANK;
    total: number;
    mustHavesMet: number;
  } | null;
}

// The AI's order: band, then total, then must-haves met. The code settles ties
// so the same data always gives the same ten.
export function topTen(apps: RankedApplication[]) {
  return apps
    .filter((a) => a.score)
    .sort((a, b) => {
      const x = a.score!;
      const y = b.score!;
      return (
        BAND_RANK[x.band] - BAND_RANK[y.band] ||
        y.total - x.total ||
        y.mustHavesMet - x.mustHavesMet ||
        a.code.localeCompare(b.code)
      );
    })
    .slice(0, 10);
}

export function overlap(apps: RankedApplication[], screened: Set<string>) {
  const top = topTen(apps);
  const inTop = new Set(top.map((a) => a.id));
  return {
    topSize: top.length,
    screenedInTop: top.filter((a) => screened.has(a.id)).length,
    outside: apps
      .filter((a) => screened.has(a.id) && !inTop.has(a.id))
      .map((a) => ({ id: a.candidateId, code: a.code }))
      .sort((a, b) => a.code.localeCompare(b.code)),
  };
}

// A small seeded generator, so a reload of the same week shows the same sample.
function seeded(seed: string) {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T extends { applicationId: string }>(
  seed: string,
  items: T[],
) {
  const random = seeded(seed);
  const out = [...items].sort((a, b) =>
    a.applicationId.localeCompare(b.applicationId),
  );
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Ten decisions: what has already been reviewed stays, then disagreements,
// then agreements chosen at random. The week start seeds every choice.
export function pickSample<T extends { applicationId: string }>(
  weekStart: string,
  disagreements: T[],
  agreements: T[],
  reviewed: Set<string>,
): { item: T; disagreement: boolean }[] {
  const tagged = [
    ...shuffled(`${weekStart}:d`, disagreements).map((item) => ({
      item,
      disagreement: true,
    })),
    ...shuffled(`${weekStart}:a`, agreements).map((item) => ({
      item,
      disagreement: false,
    })),
  ];
  const kept = tagged.filter((t) => reviewed.has(t.item.applicationId));
  const fresh = tagged.filter((t) => !reviewed.has(t.item.applicationId));
  const chosen = [...kept, ...fresh].slice(0, SAMPLE_SIZE);
  return chosen.sort((a, b) => Number(b.disagreement) - Number(a.disagreement));
}
