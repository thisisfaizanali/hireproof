"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  BAND_LABEL,
  DECISION_LABEL,
  SAMPLE_VERDICTS,
  addDays,
  formatReqNumber,
  formatWeek,
  type AgreementRow,
  type DecisionBand,
  type Disagreement,
  type SampleItem,
  type SampleVerdict,
  type WeekInsights,
} from "@hireproof/shared";
import { EmptyState } from "@/components/empty-state";
import { BandLabel } from "@/components/score";
import { formatStamp } from "@/components/status";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";

const bandName = (band: DecisionBand) =>
  band === "NOT_SCORED" ? "Not scored" : BAND_LABEL[band];

const cvLink = (x: {
  candidateId: string;
  cvId: string | null;
  requisitionId: string;
}) =>
  x.cvId
    ? `/candidates/${x.candidateId}/cv/${x.cvId}?requisition=${x.requisitionId}`
    : `/candidates/${x.candidateId}`;

const COLUMNS: [keyof Omit<AgreementRow, "band">, string][] = [
  ["screened", "Recruiter screened"],
  ["rejected", "Recruiter rejected (Not a fit)"],
  ["submitted", "Submitted"],
  ["shortlisted", "Client shortlisted"],
  ["clientRejected", "Client rejected"],
];

const OUTCOMES = [
  ["OK", "OK"],
  ["RETRIED_OK", "Retried, then OK"],
  ["INVALID_OUTPUT", "Invalid output"],
  ["PROVIDER_ERROR", "Provider error"],
  ["NOT_CONFIGURED", "Not configured"],
] as const;

const RUN_KIND: Record<string, string> = {
  CV_PARSE: "Reading CVs",
  CV_SCORE: "Scoring CVs",
  JD_EXTRACT: "Reading job descriptions",
};

const FUNNEL = [
  ["sourced", "Sourced"],
  ["screened", "Screened"],
  ["submitted", "Submitted"],
  ["shortlisted", "Shortlisted"],
  ["interview", "Interview"],
  ["offered", "Offered"],
  ["joined", "Joined"],
] as const;

type Load =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; data: WeekInsights };

export function InsightsView({ initialWeek }: { initialWeek: string | null }) {
  const [week, setWeek] = useState<string | null>(initialWeek);
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    const query = week ? `?start=${week}` : "";
    void api<WeekInsights>(`/api/insights/week${query}`).then((res) => {
      if (!current) return;
      setLoad(
        res.ok
          ? { state: "ready", data: res.data }
          : { state: "error", message: res.error },
      );
    });
    return () => {
      current = false;
    };
  }, [week, attempt]);

  const go = (start: string) => {
    setLoad({ state: "loading" });
    setWeek(start);
    window.history.replaceState(null, "", `/insights?week=${start}`);
  };

  // A verdict saved on one item changes the progress and the running tally.
  const saved = useCallback(
    (applicationId: string, verdict: SampleVerdict, note: string | null) => {
      setLoad((l) => {
        if (l.state !== "ready") return l;
        const { sample } = l.data;
        const before = sample.items.find(
          (i) => i.applicationId === applicationId,
        )?.review?.verdict;
        const tally = { ...sample.tally };
        if (before) tally[before]--;
        tally[verdict]++;
        const items = sample.items.map((i) =>
          i.applicationId === applicationId
            ? { ...i, review: { verdict, note } }
            : i,
        );
        return {
          state: "ready",
          data: {
            ...l.data,
            sample: {
              items,
              tally,
              reviewed: items.filter((i) => i.review).length,
            },
          },
        };
      });
    },
    [],
  );

  const data = load.state === "ready" ? load.data : null;

  return (
    <div className="flex flex-col gap-10">
      <header className="flex flex-col gap-4 border-b border-border pb-4">
        <h1>Insights</h1>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Button
            variant="outline"
            disabled={!data}
            onClick={() => data && go(addDays(data.weekStart, -7))}
          >
            Previous week
          </Button>
          <p
            className="num min-w-44 text-center text-sm font-medium"
            aria-live="polite"
          >
            {data ? formatWeek(data.weekStart) : "Loading"}
          </p>
          <Button
            variant="outline"
            disabled={!data || data.weekStart >= data.thisWeek}
            onClick={() => data && go(addDays(data.weekStart, 7))}
          >
            Next week
          </Button>
          {data && data.weekStart < data.thisWeek && (
            <Button variant="ghost" onClick={() => go(data.thisWeek)}>
              Back to this week
            </Button>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          Weeks run from Monday 00:00 to Sunday 23:59 IST.
        </p>
      </header>

      {load.state === "loading" && (
        <div
          role="status"
          aria-label="Loading insights"
          className="flex flex-col gap-4"
        >
          <div className="h-5 w-2/3 rounded-sm bg-muted" />
          <div className="h-40 rounded-lg bg-muted" />
        </div>
      )}

      {load.state === "error" && (
        <section
          role="alert"
          className="rounded-lg border border-border bg-card px-5 py-6"
        >
          <h2>Insights could not load</h2>
          <p className="mt-1 text-muted-foreground">{load.message}</p>
          <Button
            variant="outline"
            className="mt-4"
            onClick={() => {
              setLoad({ state: "loading" });
              setAttempt((n) => n + 1);
            }}
          >
            Try again
          </Button>
        </section>
      )}

      {data && <Week data={data} onSaved={saved} />}
    </div>
  );
}

function Week({
  data,
  onSaved,
}: {
  data: WeekInsights;
  onSaved: (id: string, verdict: SampleVerdict, note: string | null) => void;
}) {
  const { agreement } = data;
  const decisions = agreement.rows.reduce(
    (n, r) =>
      n +
      r.screened +
      r.rejected +
      r.submitted +
      r.shortlisted +
      r.clientRejected,
    0,
  );
  if (decisions === 0) {
    return (
      <>
        <EmptyState title="No decisions this week.">
          Screening, submissions and client answers appear here as they happen.
        </EmptyState>
        <HealthAndFunnel data={data} />
      </>
    );
  }
  const unscored = agreement.rows.find((r) => r.band === "NOT_SCORED")!;
  const left = unscored.screened + unscored.rejected;
  const isThisWeek = data.weekStart === data.thisWeek;

  return (
    <>
      <section aria-labelledby="agree-heading" className="flex flex-col gap-4">
        <h2 id="agree-heading">AI and recruiters</h2>
        <p className="text-md font-medium">
          {isThisWeek ? "This week" : "That week"} the AI and recruiters agreed
          on <span className="num">{agreement.agreed}</span> of{" "}
          <span className="num">{agreement.compared}</span> screening decisions.
        </p>
        <p className="text-sm text-muted-foreground">
          They agree when a Strong or Possible match is screened, or a Weak
          match is turned down.
          {left > 0 &&
            ` ${left} ${left === 1 ? "decision was" : "decisions were"} made on candidates with no AI score and ${left === 1 ? "is" : "are"} left out of that count.`}
        </p>
        <AgreementTable rows={agreement.rows} />
      </section>

      <Disagreements rows={data.disagreements} />
      <Sample data={data} onSaved={onSaved} />
      <Overlap rows={data.overlap} />
      <HealthAndFunnel data={data} />
    </>
  );
}

function AgreementTable({ rows }: { rows: AgreementRow[] }) {
  const total = (key: (typeof COLUMNS)[number][0]) =>
    rows.reduce((n, r) => n + r[key], 0);
  return (
    <>
      <table className="hidden w-full border-collapse text-sm md:table">
        <caption className="visually-hidden">
          Decisions by the AI band at the time
        </caption>
        <thead>
          <tr className="border-b border-border text-left text-muted-foreground">
            <th scope="col" className="py-2 pr-4 font-medium">
              AI band at the time
            </th>
            {COLUMNS.map(([key, label]) => (
              <th
                key={key}
                scope="col"
                className="py-2 pl-4 text-right font-medium"
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.band} className="border-b border-border">
              <th scope="row" className="py-3 pr-4 text-left font-medium">
                {bandName(r.band)}
              </th>
              {COLUMNS.map(([key]) => (
                <td key={key} className="num py-3 pl-4 text-right">
                  {r[key]}
                </td>
              ))}
            </tr>
          ))}
          <tr>
            <th scope="row" className="py-3 pr-4 text-left font-medium">
              All decisions
            </th>
            {COLUMNS.map(([key]) => (
              <td key={key} className="num py-3 pl-4 text-right font-medium">
                {total(key)}
              </td>
            ))}
          </tr>
        </tbody>
      </table>

      <ul className="flex flex-col border-t border-border md:hidden">
        {rows.map((r) => (
          <li key={r.band} className="border-b border-border py-3">
            <p className="font-medium">{bandName(r.band)}</p>
            <dl className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 text-sm">
              {COLUMNS.map(([key, label]) => (
                <div key={key} className="contents">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="num text-right">{r[key]}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
    </>
  );
}

const what = (x: { action: Disagreement["action"]; reason: string | null }) =>
  x.reason
    ? `${DECISION_LABEL[x.action]}, ${x.reason.toLowerCase()}`
    : DECISION_LABEL[x.action];

function Disagreements({ rows }: { rows: Disagreement[] }) {
  return (
    <section aria-labelledby="dis-heading" className="flex flex-col gap-4">
      <h2 id="dis-heading">Disagreements</h2>
      <p className="text-sm text-muted-foreground">
        A Strong match turned down, or a Weak match that was screened, submitted
        or shortlisted by the client. Opening the CV is logged as usual.
      </p>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No disagreements in the week.
        </p>
      ) : (
        <>
          <table className="hidden w-full border-collapse text-sm md:table">
            <caption className="visually-hidden">Disagreements</caption>
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                {[
                  "Candidate",
                  "Requisition",
                  "The AI said",
                  "What happened",
                  "By",
                  "When",
                ].map((h) => (
                  <th key={h} scope="col" className="py-2 pr-4 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <tr
                  key={d.applicationId}
                  className="border-b border-border hover:bg-accent"
                >
                  <td className="num py-3 pr-4">
                    <Link
                      href={cvLink(d)}
                      className="underline underline-offset-4 hover:no-underline"
                    >
                      {d.candidateCode}
                    </Link>
                  </td>
                  <td className="num py-3 pr-4">
                    {formatReqNumber(d.requisitionNumber)}
                  </td>
                  <td className="py-3 pr-4">
                    <span className="flex items-center gap-2">
                      <BandLabel band={d.band} />
                      {d.total !== null && (
                        <span className="num">{d.total}</span>
                      )}
                    </span>
                  </td>
                  <td className="py-3 pr-4">{what(d)}</td>
                  <td className="py-3 pr-4">{d.by}</td>
                  <td className="py-3 pr-4 text-muted-foreground">
                    {formatStamp(d.at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <ul className="flex flex-col border-t border-border md:hidden">
            {rows.map((d) => (
              <li
                key={d.applicationId}
                className="flex flex-col gap-1.5 border-b border-border py-3"
              >
                <span className="flex items-baseline justify-between gap-3">
                  <Link
                    href={cvLink(d)}
                    className="num underline underline-offset-4"
                  >
                    {d.candidateCode}
                  </Link>
                  <span className="num text-sm text-muted-foreground">
                    {formatReqNumber(d.requisitionNumber)}
                  </span>
                </span>
                <span className="flex flex-wrap items-center gap-2 text-sm">
                  The AI said <BandLabel band={d.band} />
                  {d.total !== null && <span className="num">{d.total}</span>}
                </span>
                <span className="text-sm">{what(d)}</span>
                <span className="text-sm text-muted-foreground">
                  {d.by}, {formatStamp(d.at)}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function Sample({
  data,
  onSaved,
}: {
  data: WeekInsights;
  onSaved: (id: string, verdict: SampleVerdict, note: string | null) => void;
}) {
  const { items, reviewed, tally } = data.sample;
  const totalReviewed =
    tally.AI_RIGHT + tally.RECRUITER_RIGHT + tally.BOTH_REASONABLE;
  return (
    <section aria-labelledby="sample-heading" className="flex flex-col gap-4">
      <h2 id="sample-heading">Weekly sample</h2>
      <p className="text-sm text-muted-foreground">
        Up to ten decisions from the week, disagreements first, the same ten
        each time you open the page. Say who you think was right.
      </p>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing to review: no decision in the week had an AI score to compare
          with.
        </p>
      ) : (
        <>
          <p role="status" className="text-sm font-medium">
            <span className="num">{reviewed}</span> of{" "}
            <span className="num">{items.length}</span> reviewed
          </p>
          <ul className="border-t border-border">
            {items.map((item) => (
              <SampleRow
                key={item.applicationId}
                item={item}
                weekStart={data.weekStart}
                onSaved={onSaved}
              />
            ))}
          </ul>
        </>
      )}
      <p className="text-sm text-muted-foreground">
        Across all weeks, of <span className="num">{totalReviewed}</span>{" "}
        reviewed: AI was right <span className="num">{tally.AI_RIGHT}</span>,
        recruiter was right <span className="num">{tally.RECRUITER_RIGHT}</span>
        , both reasonable <span className="num">{tally.BOTH_REASONABLE}</span>.
      </p>
    </section>
  );
}

function SampleRow({
  item,
  weekStart,
  onSaved,
}: {
  item: SampleItem;
  weekStart: string;
  onSaved: (id: string, verdict: SampleVerdict, note: string | null) => void;
}) {
  const [note, setNote] = useState(item.review?.note ?? "");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );
  const [problem, setProblem] = useState<string | null>(null);

  async function save(verdict: SampleVerdict) {
    setStatus("saving");
    setProblem(null);
    const res = await api<{ verdict: SampleVerdict; note: string | null }>(
      `/api/insights/sample/${item.applicationId}/review`,
      { json: { weekStart, verdict, note: note.trim() || undefined } },
    );
    if (!res.ok) {
      setStatus("error");
      setProblem(res.error);
      return;
    }
    setStatus("saved");
    onSaved(item.applicationId, verdict, res.data.note);
  }

  const chosen = item.review?.verdict;
  const noteChanged = chosen && note.trim() !== (item.review?.note ?? "");
  return (
    <li className="flex flex-col gap-3 border-b border-border py-4">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <Link
          href={cvLink(item)}
          className="num font-medium underline underline-offset-4"
        >
          {item.candidateCode}
        </Link>
        <span className="num text-sm text-muted-foreground">
          {formatReqNumber(item.requisitionNumber)}
        </span>
        {item.disagreement && (
          <span className="rounded-sm bg-warning-soft px-2 py-0.5 text-xs font-medium text-warning">
            AI and recruiter disagreed
          </span>
        )}
      </div>
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        The AI said <BandLabel band={item.band} />
        {item.total !== null && <span className="num">{item.total}</span>}
        <span className="text-muted-foreground">and the decision was</span>
        <span className="font-medium">{what(item)}</span>
      </p>
      <div
        role="group"
        aria-label={`Who was right for ${item.candidateCode}`}
        className="flex flex-wrap gap-2"
      >
        {SAMPLE_VERDICTS.map(([value, label]) => (
          <Button
            key={value}
            variant="outline"
            size="sm"
            aria-pressed={chosen === value}
            disabled={status === "saving"}
            className={chosen === value ? "border-ring bg-primary-soft" : ""}
            onClick={() => void save(value)}
          >
            {label}
          </Button>
        ))}
      </div>
      <div className="flex flex-col gap-1.5 sm:max-w-xl sm:flex-row sm:items-center">
        <Input
          aria-label={`Note on ${item.candidateCode}`}
          placeholder="A note, if you want one"
          value={note}
          maxLength={500}
          onChange={(e) => {
            setNote(e.target.value);
            setStatus("idle");
          }}
        />
        {noteChanged && (
          <Button variant="ghost" size="sm" onClick={() => void save(chosen)}>
            Save note
          </Button>
        )}
      </div>
      <p aria-live="polite" className="min-h-5 text-sm text-muted-foreground">
        {status === "saving" && "Saving"}
        {status === "saved" && "Saved"}
        {problem && <span className="text-destructive">{problem}</span>}
      </p>
    </li>
  );
}

function Overlap({ rows }: { rows: WeekInsights["overlap"] }) {
  return (
    <section aria-labelledby="overlap-heading" className="flex flex-col gap-4">
      <h2 id="overlap-heading">The AI&apos;s top ten against screening</h2>
      <p className="text-sm text-muted-foreground">
        Ranks use the scores on file now, for candidates who existed by the end
        of the week. Screened candidates outside the top ten are what the
        recruiter found that the AI ranked lower.
      </p>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No requisition had a screening decision in the week.
        </p>
      ) : (
        <ul className="border-t border-border">
          {rows.map((r) => (
            <li
              key={r.requisitionId}
              className="flex flex-col gap-1.5 border-b border-border py-3 text-sm"
            >
              <span className="flex flex-wrap items-baseline gap-x-3">
                <Link
                  href={`/requisitions/${r.requisitionId}?tab=candidates`}
                  className="num underline underline-offset-4"
                >
                  {formatReqNumber(r.number)}
                </Link>
                <span className="font-medium">{r.title}</span>
              </span>
              <span>
                <span className="num">{r.screenedInTop}</span> of the AI&apos;s
                top <span className="num">{r.topSize}</span> were screened.
              </span>
              <span>
                {r.outside.length === 0 ? (
                  "No screened candidate sat outside its top ten."
                ) : (
                  <>
                    Screened outside the top ten:{" "}
                    {r.outside.map((c, i) => (
                      <span key={c.id}>
                        {i > 0 && ", "}
                        <Link
                          href={`/candidates/${c.id}`}
                          className="num underline underline-offset-4"
                        >
                          {c.code}
                        </Link>
                      </span>
                    ))}
                    .
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function HealthAndFunnel({ data }: { data: WeekInsights }) {
  const { health, funnel } = data;
  const kinds = [...new Set(health.runs.map((r) => r.kind))];
  const count = (kind: string, outcome: string) =>
    health.runs.find((r) => r.kind === kind && r.outcome === outcome)?.count ??
    0;
  const { total, verified } = health.quotes;
  const pct = total === 0 ? null : Math.round((verified / total) * 100);

  return (
    <>
      <section aria-labelledby="health-heading" className="flex flex-col gap-4">
        <h2 id="health-heading">AI health</h2>
        <p className="text-sm">
          Scores made in the week:{" "}
          <span className="num">{health.scoresBySource.AI}</span> by the AI,{" "}
          <span className="num">{health.scoresBySource.RULES}</span> by rules.
        </p>
        {health.scoresBySource.RULES > 0 && (
          <p className="rounded-md bg-review-soft px-4 py-3 text-sm text-review">
            {health.scoresBySource.RULES}{" "}
            {health.scoresBySource.RULES === 1 ? "score was" : "scores were"}{" "}
            worked out with rules because the AI was not available. Check the
            evidence on those before relying on them.
          </p>
        )}
        {kinds.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No AI calls were made in the week.
          </p>
        ) : (
          <>
            <table className="hidden w-full border-collapse text-sm md:table">
              <caption className="visually-hidden">AI calls by outcome</caption>
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th scope="col" className="py-2 pr-4 font-medium">
                    AI calls
                  </th>
                  {OUTCOMES.map(([key, label]) => (
                    <th
                      key={key}
                      scope="col"
                      className="py-2 pl-4 text-right font-medium"
                    >
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {kinds.map((kind) => (
                  <tr key={kind} className="border-b border-border">
                    <th scope="row" className="py-3 pr-4 text-left font-medium">
                      {RUN_KIND[kind] ?? kind}
                    </th>
                    {OUTCOMES.map(([key]) => (
                      <td key={key} className="num py-3 pl-4 text-right">
                        {count(kind, key)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <ul className="flex flex-col border-t border-border md:hidden">
              {kinds.map((kind) => (
                <li key={kind} className="border-b border-border py-3">
                  <p className="font-medium">{RUN_KIND[kind] ?? kind}</p>
                  <dl className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 text-sm">
                    {OUTCOMES.map(([key, label]) => (
                      <div key={key} className="contents">
                        <dt className="text-muted-foreground">{label}</dt>
                        <dd className="num text-right">{count(kind, key)}</dd>
                      </div>
                    ))}
                  </dl>
                </li>
              ))}
            </ul>
          </>
        )}
        <ul className="flex flex-col gap-1 text-sm">
          <li>
            Tokens used:{" "}
            <span className="num">
              {health.inputTokens.toLocaleString("en-IN")}
            </span>{" "}
            in,{" "}
            <span className="num">
              {health.outputTokens.toLocaleString("en-IN")}
            </span>{" "}
            out.
          </li>
          <li>
            {pct === null ? (
              "The AI cited no quotes in the week."
            ) : (
              <>
                <span className="num">{verified}</span> of{" "}
                <span className="num">{total}</span> quotes the AI cited were
                found in the CV (<span className="num">{pct}%</span>).
              </>
            )}{" "}
            <span className="num">{health.downgrades}</span>{" "}
            {health.downgrades === 1 ? "verdict was" : "verdicts were"}{" "}
            downgraded because the quote was not there.
          </li>
          <li>
            <span className="num">{health.reviewReasons}</span> review{" "}
            {health.reviewReasons === 1 ? "reason" : "reasons"} raised on CVs
            read in the week.
          </li>
        </ul>
      </section>

      <section aria-labelledby="funnel-heading" className="flex flex-col gap-4">
        <h2 id="funnel-heading">Pipeline for the week</h2>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 border-t border-border pt-3 text-sm sm:grid-cols-4 lg:grid-cols-7">
          {FUNNEL.map(([key, label]) => (
            <div key={key}>
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="num text-lg font-medium">{funnel[key]}</dd>
            </div>
          ))}
        </dl>
      </section>
    </>
  );
}
