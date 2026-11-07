"use client";

import {
  BAND_LABEL,
  REJECT_REASONS,
  SCORE_STATE_LABEL,
  type Band,
  type CriterionScore,
  type RejectReason,
  type ScoreDetail,
  type ScoreState,
} from "@hireproof/shared";

const base = "inline-block rounded-sm px-2 py-0.5 text-xs font-medium";

export const STAGE_LABEL: Record<string, string> = {
  SOURCED: "Sourced",
  SCREENED: "Screened",
  SUBMITTED: "Submitted",
  CLIENT_SHORTLISTED: "Shortlisted by client",
  INTERVIEW: "Interview",
  OFFERED: "Offered",
  JOINED: "Joined",
  REJECTED: "Not a fit",
  WITHDRAWN: "Withdrawn",
};

export const rejectLabel = (reason: RejectReason | null) =>
  REJECT_REASONS.find(([value]) => value === reason)?.[1] ?? "Other";

// Strong takes the accent fill; the others stay neutral. The words carry the
// meaning, the fill only helps the eye find the strong ones.
export function BandLabel({ band }: { band: Band }) {
  return (
    <span
      className={`${base} ${band === "STRONG" ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"}`}
    >
      {BAND_LABEL[band]}
    </span>
  );
}

export const pendingLabel = (state: Exclude<ScoreState, "SCORED">) =>
  SCORE_STATE_LABEL[state];

const VERDICT: Record<CriterionScore["verdict"], string> = {
  MET: "Met",
  PARTIAL: "Partial",
  NOT_FOUND: "Not found",
};

const points = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

// The two flag kinds that are about trust in the score, not about the person.
const isTrustFlag = (flag: string) =>
  flag.startsWith("The AI cited") || flag.startsWith("Scored without AI");

function Quotes({
  criterion,
  onPick,
}: {
  criterion: CriterionScore;
  onPick?: (quote: string) => void;
}) {
  return (
    <>
      {criterion.quotes.map((q, i) =>
        q.verified ? (
          onPick ? (
            <button
              key={i}
              type="button"
              onClick={() => onPick(q.text)}
              className="border-l-2 border-input py-0.5 pl-3 text-left text-sm transition-colors duration-(--dur-micro) hover:bg-accent"
            >
              {"“"}
              {q.text}
              {"”"}
            </button>
          ) : (
            <p key={i} className="border-l-2 border-input py-0.5 pl-3 text-sm">
              {"“"}
              {q.text}
              {"”"}
            </p>
          )
        ) : (
          <p
            key={i}
            className="rounded-sm bg-review-soft px-3 py-1.5 text-sm text-review"
          >
            <span className="font-medium">Not found in the CV:</span> {"“"}
            {q.text}
            {"”"}
          </p>
        ),
      )}
    </>
  );
}

function CriterionList({
  title,
  items,
  onPick,
}: {
  title: string;
  items: CriterionScore[];
  onPick?: (quote: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <section className="flex flex-col gap-1">
      <h3 className="text-sm font-medium text-muted-foreground">{title}</h3>
      <ul className="border-t border-border">
        {items.map((c) => (
          <li
            key={c.id}
            className="flex flex-col gap-1.5 border-b border-border py-2.5"
          >
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 break-words font-medium">{c.label}</span>
              <span className="num shrink-0 text-sm">
                {points(c.points)} of {points(c.maxPoints)}
              </span>
            </div>
            <p
              className={`text-sm ${c.verdict === "NOT_FOUND" ? "text-muted-foreground" : ""}`}
            >
              {VERDICT[c.verdict]}
            </p>
            <Quotes criterion={c} onPick={onPick} />
            {c.flag && c.quotes.length === 0 && (
              <p className="text-sm text-review">{c.flag}.</p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

// The whole case for one score, top to bottom: the total, the flags that need
// a person, each criterion with its checked quotes, then experience.
export function ScorePanel({
  score,
  onPick,
}: {
  score: ScoreDetail;
  onPick?: (quote: string) => void;
}) {
  const musts = score.criteria.filter((c) => c.kind === "MUST_HAVE");
  const nices = score.criteria.filter((c) => c.kind === "NICE_TO_HAVE");
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5">
        <span className="num text-2xl leading-none">{score.total}</span>
        <span className="text-sm text-muted-foreground">out of 100</span>
        <BandLabel band={score.band} />
        {score.mustHavesTotal > 0 && (
          <span className="text-sm">
            <span className="num">{score.mustHavesMet}</span> of{" "}
            <span className="num">{score.mustHavesTotal}</span> must-haves met
          </span>
        )}
        {score.source === "RULES" && (
          <span className={`${base} bg-review-soft text-review`}>
            Scored without AI
          </span>
        )}
      </div>

      {score.flags.length > 0 && (
        <ul className="flex flex-col gap-1.5" aria-label="Flags">
          {score.flags.map((flag) => (
            <li
              key={flag}
              className={`rounded-sm px-3 py-1.5 text-sm ${isTrustFlag(flag) ? "bg-review-soft text-review" : "bg-warning-soft text-warning"}`}
            >
              {flag}
            </li>
          ))}
        </ul>
      )}

      <CriterionList title="Must-haves" items={musts} onPick={onPick} />
      <CriterionList title="Nice-to-haves" items={nices} onPick={onPick} />

      <section className="flex flex-col gap-1">
        <h3 className="text-sm font-medium text-muted-foreground">
          Experience
        </h3>
        <div className="flex items-baseline justify-between gap-3 border-y border-border py-2.5">
          <span>
            {score.experienceYears === null ? (
              "Not stated in the CV"
            ) : (
              <>
                <span className="num">{score.experienceYears}</span>{" "}
                {score.experienceYears === 1 ? "year" : "years"}
              </>
            )}
          </span>
          <span className="num shrink-0 text-sm">
            {score.experiencePoints} of {score.experienceMaxPoints}
          </span>
        </div>
      </section>

      <p className="text-xs text-muted-foreground">{score.formulaText}</p>
    </div>
  );
}
