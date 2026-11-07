"use client";

import Link from "next/link";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import {
  type CandidateList,
  type CandidateRow,
  type PendingDuplicate,
  type DuplicateSide,
  type ScoreResponse,
} from "@hireproof/shared";
import { ConstraintFlagList } from "@/components/constraint-flags";
import { EmptyState } from "@/components/empty-state";
import { Flag, formatPhone, notice, years } from "@/components/cv-status";
import { CvUpload } from "@/components/cv-upload";
import {
  BandLabel,
  STAGE_LABEL,
  ScorePanel,
  pendingLabel,
} from "@/components/score";
import { Button } from "@/components/ui/button";
import { FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { api } from "@/lib/api";

const FILTERS = [
  ["", "All"],
  ["NEEDS_REVIEW", "Needs review"],
  ["SCANNED", "Scanned"],
  ["POSSIBLE_DUPLICATE", "Possible duplicate"],
  ["PARSED", "Parsed cleanly"],
] as const;

type Load =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; list: CandidateList };

export function CandidatesTab({
  requisitionId,
  canEdit,
  scorecardConfirmed,
}: {
  requisitionId: string;
  canEdit: boolean;
  scorecardConfirmed: boolean;
}) {
  // Bumped when uploads finish or a duplicate is resolved, to reload below.
  const [version, setVersion] = useState(0);
  const lastFinished = useRef(0);
  const onProgress = useCallback((finished: number) => {
    if (finished === lastFinished.current) return;
    lastFinished.current = finished;
    setVersion((v) => v + 1);
  }, []);

  return (
    <div className="flex flex-col gap-8">
      {!scorecardConfirmed && (
        <p className="rounded-md bg-warning-soft px-4 py-3 text-sm text-warning">
          Confirm the scorecard to rank candidates. CVs can be uploaded now and
          are scored once it is confirmed.
        </p>
      )}
      <CvUpload
        requisitionId={requisitionId}
        canUpload={canEdit}
        onProgress={onProgress}
      />
      <DuplicatePanel
        requisitionId={requisitionId}
        canEdit={canEdit}
        version={version}
        onResolved={() => setVersion((v) => v + 1)}
      />
      <CandidateTable requisitionId={requisitionId} version={version} />
    </div>
  );
}

const BANDS = [
  ["", "All bands"],
  ["STRONG", "Strong match"],
  ["POSSIBLE", "Possible match"],
  ["WEAK", "Weak match"],
  ["UNSCORED", "Not scored yet"],
] as const;

const STAGES = [
  ["", "All stages"],
  ["SOURCED", "Sourced"],
  ["SCREENED", "Screened"],
  ["REJECTED", "Not a fit"],
] as const;

const PENDING = ["WAITING", "SCORING", "RESCORING"];

function CandidateTable({
  requisitionId,
  version,
}: {
  requisitionId: string;
  version: number;
}) {
  const [search, setSearch] = useState("");
  const [typed, setTyped] = useState("");
  const [status, setStatus] = useState("");
  const [band, setBand] = useState("");
  const [stage, setStage] = useState("");
  const [page, setPage] = useState(1);
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [tick, setTick] = useState(0);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(typed.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [typed]);

  useEffect(() => {
    let current = true;
    const params = new URLSearchParams({ page: String(page) });
    if (search) params.set("search", search);
    if (status) params.set("status", status);
    if (band) params.set("band", band);
    if (stage) params.set("stage", stage);
    void api<CandidateList>(
      `/api/requisitions/${requisitionId}/candidates?${params}`,
    ).then((res) => {
      if (!current) return;
      setLoad((prev) =>
        res.ok
          ? { state: "ready", list: res.data }
          : prev.state === "ready"
            ? prev
            : { state: "error", message: res.error },
      );
    });
    return () => {
      current = false;
    };
  }, [
    requisitionId,
    search,
    status,
    band,
    stage,
    page,
    version,
    attempt,
    tick,
  ]);

  const list = load.state === "ready" ? load.list : null;
  const waiting =
    list?.items.some((c) => c.scoreState && PENDING.includes(c.scoreState)) ??
    false;
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(() => setTick((n) => n + 1), 4000);
    return () => clearInterval(t);
  }, [waiting]);

  const filtered =
    search !== "" || status !== "" || band !== "" || stage !== "";
  const pages = list ? Math.max(1, Math.ceil(list.total / list.pageSize)) : 1;
  const ranked = list?.ranked ?? false;

  return (
    <section
      aria-labelledby="candidates-heading"
      className="flex flex-col gap-4"
    >
      <h2 id="candidates-heading">Candidates</h2>

      {list?.progress && (
        <p className="text-sm" aria-live="polite">
          Scored <span className="num">{list.progress.scored}</span> of{" "}
          <span className="num">{list.progress.total}</span>
          {list.progress.scored < list.progress.total && (
            <span className="text-muted-foreground">
              . Scoring continues in the background.
            </span>
          )}
        </p>
      )}

      <form
        role="search"
        onSubmit={(e) => e.preventDefault()}
        className="flex flex-wrap items-end gap-x-4 gap-y-3"
      >
        <div className="flex w-full flex-col gap-1 sm:w-72">
          <FieldLabel htmlFor="candidate-search">Search</FieldLabel>
          <Input
            id="candidate-search"
            type="search"
            placeholder="Name, role or skill"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
          />
        </div>
        {ranked && (
          <div className="flex w-full flex-col gap-1 sm:w-44">
            <FieldLabel htmlFor="candidate-band">Match</FieldLabel>
            <Select
              id="candidate-band"
              value={band}
              onChange={(e) => {
                setBand(e.target.value);
                setPage(1);
              }}
            >
              {BANDS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </div>
        )}
        <div className="flex w-full flex-col gap-1 sm:w-40">
          <FieldLabel htmlFor="candidate-stage">Stage</FieldLabel>
          <Select
            id="candidate-stage"
            value={stage}
            onChange={(e) => {
              setStage(e.target.value);
              setPage(1);
            }}
          >
            {STAGES.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex w-full flex-col gap-1 sm:w-52">
          <FieldLabel htmlFor="candidate-status">Show</FieldLabel>
          <Select
            id="candidate-status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            {FILTERS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </div>
      </form>

      {load.state === "loading" && (
        <div
          role="status"
          aria-label="Loading candidates"
          className="flex flex-col"
        >
          {[0, 1, 2, 3].map((n) => (
            <div
              key={n}
              className="flex items-center gap-4 border-b border-border py-4"
            >
              <div className="h-4 w-20 rounded-sm bg-muted" />
              <div className="h-4 w-1/3 rounded-sm bg-muted" />
              <div className="hidden h-4 w-1/5 rounded-sm bg-muted md:block" />
            </div>
          ))}
        </div>
      )}

      {load.state === "error" && (
        <section
          role="alert"
          className="rounded-lg border border-border bg-card px-5 py-6"
        >
          <h2>Candidates could not load</h2>
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

      {list && list.items.length === 0 && (
        <EmptyState
          title={
            filtered
              ? "No candidates match."
              : "No CVs uploaded for this requisition yet."
          }
        >
          {filtered
            ? "Change or clear the search and filters to see more."
            : "Parsed candidates appear here as soon as their CVs are read."}
        </EmptyState>
      )}

      {list && list.items.length > 0 && (
        <>
          <table className="hidden w-full border-collapse text-sm md:table">
            <caption className="visually-hidden">
              {ranked ? "Candidates, ranked by score" : "Candidates"}
            </caption>
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                {(ranked
                  ? [
                      "Rank",
                      "Score",
                      "Must-haves",
                      "Name",
                      "Current role",
                      "Experience",
                      "Notice",
                      "Location",
                      "Flags",
                    ]
                  : [
                      "Code",
                      "Name",
                      "Current role",
                      "Experience",
                      "Notice",
                      "Location",
                      "Flags",
                    ]
                ).map((head) => (
                  <th key={head} scope="col" className="py-2 pr-4 font-medium">
                    {head}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {list.items.map((c) => (
                <Fragment key={c.id}>
                  <tr className="border-b border-border hover:bg-accent">
                    {ranked ? (
                      <>
                        <td className="num py-3 pr-4">{c.rank ?? ""}</td>
                        <td className="py-3 pr-4">
                          <ScoreCell
                            c={c}
                            open={open === c.applicationId}
                            onToggle={() =>
                              setOpen(
                                open === c.applicationId
                                  ? null
                                  : c.applicationId,
                              )
                            }
                          />
                        </td>
                        <td className="num py-3 pr-4">
                          {c.score && c.score.mustHavesTotal > 0
                            ? `${c.score.mustHavesMet} of ${c.score.mustHavesTotal}`
                            : ""}
                        </td>
                      </>
                    ) : (
                      <td className="num py-3 pr-4">{c.code}</td>
                    )}
                    <td className="py-3 pr-4 font-medium">
                      <Link
                        href={`/candidates/${c.id}`}
                        className="underline-offset-4 hover:underline"
                      >
                        {c.name}
                      </Link>
                      {c.stage !== "SOURCED" && (
                        <span className="block text-xs font-normal text-muted-foreground">
                          {STAGE_LABEL[c.stage] ?? c.stage}
                        </span>
                      )}
                    </td>
                    <td className="py-3 pr-4">
                      {c.currentRole ?? "Not stated"}
                    </td>
                    <td className="num py-3 pr-4">
                      {c.totalExperienceYears === null
                        ? "Not stated"
                        : `${c.totalExperienceYears} y`}
                    </td>
                    <td className="py-3 pr-4">
                      {notice(c.noticeText, c.noticeDays)}
                    </td>
                    <td className="py-3 pr-4">{c.location ?? "Not stated"}</td>
                    <td className="py-3">
                      <Flags c={c} />
                    </td>
                  </tr>
                  {open === c.applicationId && (
                    <tr className="border-b border-border bg-card">
                      <td colSpan={9} className="px-4 py-4">
                        <Why c={c} requisitionId={requisitionId} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>

          <ul className="flex flex-col border-t border-border md:hidden">
            {list.items.map((c) => (
              <li key={c.id} className="border-b border-border py-3">
                <div className="flex flex-col gap-1.5">
                  <span className="flex items-baseline justify-between gap-3">
                    <Link
                      href={`/candidates/${c.id}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {ranked && c.rank !== null && (
                        <span className="num mr-2 text-muted-foreground">
                          {c.rank}
                        </span>
                      )}
                      {c.name}
                    </Link>
                    <span className="num text-sm text-muted-foreground">
                      {c.code}
                    </span>
                  </span>
                  {ranked && (
                    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <ScoreCell
                        c={c}
                        open={open === c.applicationId}
                        onToggle={() =>
                          setOpen(
                            open === c.applicationId ? null : c.applicationId,
                          )
                        }
                      />
                      {c.score && c.score.mustHavesTotal > 0 && (
                        <span className="text-sm">
                          <span className="num">{c.score.mustHavesMet}</span> of{" "}
                          <span className="num">{c.score.mustHavesTotal}</span>{" "}
                          must-haves
                        </span>
                      )}
                    </span>
                  )}
                  <span className="text-sm text-muted-foreground">
                    {c.currentRole ?? "Role not stated"},{" "}
                    {c.location ?? "location not stated"}
                  </span>
                  <span className="text-sm">
                    {c.totalExperienceYears === null ? (
                      "Experience not stated"
                    ) : (
                      <>
                        <span className="num">{c.totalExperienceYears}</span>{" "}
                        years
                      </>
                    )}
                    ,{" "}
                    {c.noticeDays === null
                      ? (c.noticeText ?? "notice not stated")
                      : `notice ${notice(c.noticeText, c.noticeDays).toLowerCase()}`}
                  </span>
                  {c.stage !== "SOURCED" && (
                    <span className="text-sm text-muted-foreground">
                      {STAGE_LABEL[c.stage] ?? c.stage}
                    </span>
                  )}
                  <Flags c={c} />
                  {open === c.applicationId && (
                    <div className="mt-2 border-t border-border pt-3">
                      <Why c={c} requisitionId={requisitionId} />
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>

          <nav
            aria-label="Pages"
            className="flex items-center justify-between gap-3 text-sm"
          >
            <span className="text-muted-foreground">
              {list.total} {list.total === 1 ? "candidate" : "candidates"}
            </span>
            {pages > 1 && (
              <span className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage(page - 1)}
                >
                  Previous
                </Button>
                <span className="num">
                  {page} of {pages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= pages}
                  onClick={() => setPage(page + 1)}
                >
                  Next
                </Button>
              </span>
            )}
          </nav>
        </>
      )}
    </section>
  );
}

// The score and its band in words, or why there is no score yet.
function ScoreCell({
  c,
  open,
  onToggle,
}: {
  c: CandidateRow;
  open: boolean;
  onToggle: () => void;
}) {
  if (!c.score) {
    return (
      <span className="text-sm text-muted-foreground">
        {c.scoreState && c.scoreState !== "SCORED"
          ? pendingLabel(c.scoreState)
          : ""}
      </span>
    );
  }
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="num text-md">{c.score.total}</span>
      <BandLabel band={c.score.band} />
      {c.score.source === "RULES" && (
        <span className="text-xs text-review">Scored without AI</span>
      )}
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="rounded-sm text-sm whitespace-nowrap underline underline-offset-4 hover:no-underline"
      >
        {open ? "Hide why" : "Why this score"}
      </button>
    </span>
  );
}

// Loads the breakdown only when a row is opened.
function Why({ c, requisitionId }: { c: CandidateRow; requisitionId: string }) {
  const [state, setState] = useState<
    | { state: "loading" }
    | { state: "error"; message: string }
    | { state: "ready"; data: ScoreResponse }
  >({ state: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    void api<ScoreResponse>(`/api/applications/${c.applicationId}/score`).then(
      (res) => {
        if (current) {
          setState(
            res.ok
              ? { state: "ready", data: res.data }
              : { state: "error", message: res.error },
          );
        }
      },
    );
    return () => {
      current = false;
    };
  }, [c.applicationId, attempt]);

  if (state.state === "loading") {
    return (
      <div
        role="status"
        aria-label="Loading the breakdown"
        className="h-32 rounded-md bg-muted"
      />
    );
  }
  if (state.state === "error") {
    return (
      <div role="alert" className="flex flex-col items-start gap-2">
        <p className="text-sm text-destructive">{state.message}</p>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setState({ state: "loading" });
            setAttempt((n) => n + 1);
          }}
        >
          Try again
        </Button>
      </div>
    );
  }
  const { score } = state.data;
  return (
    <div className="flex max-w-2xl flex-col gap-3">
      {score ? (
        <ScorePanel score={score} />
      ) : (
        <p className="text-sm text-muted-foreground">
          {pendingLabel(
            state.data.state === "SCORED" ? "WAITING" : state.data.state,
          )}
          .
        </p>
      )}
      {c.cvId && (
        <Link
          href={`/candidates/${c.id}/cv/${c.cvId}?requisition=${requisitionId}`}
          className="self-start text-sm underline underline-offset-4 hover:no-underline"
        >
          Open the CV with the evidence marked
        </Link>
      )}
    </div>
  );
}

function Flags({ c }: { c: CandidateRow }) {
  if (
    !c.scanned &&
    !c.needsReview &&
    !c.possibleDuplicate &&
    c.constraintFlags.length === 0
  ) {
    return null;
  }
  return (
    <span className="flex flex-wrap gap-1.5">
      <ConstraintFlagList flags={c.constraintFlags} />
      {c.scanned && <Flag tone="muted">Scan</Flag>}
      {c.needsReview && <Flag tone="review">Needs review</Flag>}
      {c.possibleDuplicate && <Flag tone="warning">Possible duplicate</Flag>}
    </span>
  );
}

function DuplicatePanel({
  requisitionId,
  canEdit,
  version,
  onResolved,
}: {
  requisitionId: string;
  canEdit: boolean;
  version: number;
  onResolved: () => void;
}) {
  const [items, setItems] = useState<PendingDuplicate[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    void api<PendingDuplicate[]>(
      `/api/duplicates?status=PENDING&requisitionId=${requisitionId}`,
    ).then((res) => {
      if (current && res.ok) setItems(res.data);
    });
    return () => {
      current = false;
    };
  }, [requisitionId, version]);

  async function resolve(id: string, samePerson: boolean) {
    setBusy(id);
    setProblem(null);
    const res = await api<{ ok: true }>(`/api/duplicates/${id}/resolve`, {
      json: { samePerson },
    });
    setBusy(null);
    if (res.ok) {
      setItems((list) => list.filter((d) => d.id !== id));
      onResolved();
    } else {
      setProblem(res.error);
    }
  }

  if (items.length === 0) return null;

  return (
    <section
      aria-labelledby="duplicates-heading"
      className="flex flex-col gap-4"
    >
      <div>
        <h2 id="duplicates-heading">Possible duplicates</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          These CVs share a name and read very alike, but have different contact
          details. Nothing is merged until a recruiter decides.
        </p>
      </div>
      {problem && (
        <p
          role="alert"
          className="rounded-md bg-destructive-soft px-4 py-3 text-sm text-destructive"
        >
          {problem}
        </p>
      )}
      {items.map((d) => (
        <article
          key={d.id}
          aria-label={`${d.incoming.name}, possible duplicate`}
          className="flex flex-col gap-4 rounded-lg border border-border bg-card px-4 py-4"
        >
          <p className="text-sm">
            {d.reason}
            {d.similarity !== null && (
              <>
                , <span className="num">{Math.round(d.similarity * 100)}%</span>{" "}
                alike
              </>
            )}
            . New file: {d.fileName}
          </p>
          <div className="grid gap-4 md:grid-cols-2">
            <Side title="This CV" side={d.incoming} />
            <Side title="Already on file" side={d.existing} />
          </div>
          {canEdit && (
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={busy === d.id}
                onClick={() => void resolve(d.id, true)}
              >
                Same person
              </Button>
              <Button
                variant="outline"
                disabled={busy === d.id}
                onClick={() => void resolve(d.id, false)}
              >
                Different people
              </Button>
            </div>
          )}
        </article>
      ))}
    </section>
  );
}

function Side({ title, side }: { title: string; side: DuplicateSide }) {
  const rows: [string, React.ReactNode][] = [
    ["Name", side.name],
    ["Email", side.email ?? "Not stated"],
    ["Phone", formatPhone(side.phone) ?? "Not stated"],
    ["Current role", side.currentRole ?? "Not stated"],
    [
      "Employers",
      side.employers.length > 0 ? side.employers.join(", ") : "Not found",
    ],
    ["Experience", years(side.totalExperienceYears)],
  ];
  return (
    <div className="min-w-0 rounded-md bg-muted px-4 py-3">
      <h3>{title}</h3>
      <p className="num text-sm text-muted-foreground">{side.code}</p>
      <dl className="mt-2 grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="break-words">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
