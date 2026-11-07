"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  REJECT_REASONS,
  SCREEN_GATE_MESSAGE,
  findQuote,
  formatReqNumber,
  type ApplicationInfo,
  type CandidateDetail,
  type CvText,
  type RejectReason,
  type ScoreResponse,
  type Stage,
} from "@hireproof/shared";
import { EmptyState } from "@/components/empty-state";
import {
  PipelineActions,
  clientDecisionText,
} from "@/components/pipeline-actions";
import {
  BandLabel,
  STAGE_LABEL,
  ScorePanel,
  pendingLabel,
  rejectLabel,
} from "@/components/score";
import { Button } from "@/components/ui/button";
import { FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { api } from "@/lib/api";

interface Loaded {
  candidate: CandidateDetail;
  info: ScoreResponse;
}

type Load =
  | { state: "loading" }
  | { state: "error"; message: string; notFound: boolean }
  | ({ state: "ready" } & Loaded);

// Cuts the text at each verified quote so the evidence can be marked in place.
function segments(text: string, quotes: string[]) {
  const found = quotes
    .flatMap((quote) => {
      const at = findQuote(text, quote);
      return at ? [{ ...at, quote }] : [];
    })
    .sort((a, b) => a.start - b.start);
  const out: { text: string; quote?: string }[] = [];
  let at = 0;
  for (const f of found) {
    if (f.start < at) continue;
    if (f.start > at) out.push({ text: text.slice(at, f.start) });
    out.push({ text: text.slice(f.start, f.end), quote: f.quote });
    at = f.end;
  }
  if (at < text.length) out.push({ text: text.slice(at) });
  return { parts: out, located: found.length };
}

export function CvViewer({
  candidateId,
  cvId,
  requisitionId,
  canDecide,
}: {
  candidateId: string;
  cvId: string;
  requisitionId: string | null;
  canDecide: boolean;
}) {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [pick, setPick] = useState<{ quote: string } | null>(null);

  const fetchAll = useCallback(async () => {
    const c = await api<CandidateDetail>(`/api/candidates/${candidateId}`);
    if (!c.ok) return c;
    const app =
      c.data.applications.find((a) => a.requisition.id === requisitionId) ??
      c.data.applications[0];
    if (!app) {
      return {
        ok: false as const,
        status: 404,
        error: "This candidate has no application to show.",
        fields: {},
      };
    }
    const s = await api<ScoreResponse>(`/api/applications/${app.id}/score`);
    if (!s.ok) return s;
    return { ok: true as const, data: { candidate: c.data, info: s.data } };
  }, [candidateId, requisitionId]);

  useEffect(() => {
    let current = true;
    void fetchAll().then((res) => {
      if (!current) return;
      setLoad(
        res.ok
          ? { state: "ready", ...res.data }
          : {
              state: "error",
              message: res.error,
              notFound: res.status === 404,
            },
      );
    });
    return () => {
      current = false;
    };
  }, [fetchAll, attempt]);

  // Opening the CV is logged by the server; ask again so the gate updates.
  const refreshInfo = useCallback(async () => {
    const res = await fetchAll();
    if (res.ok) setLoad({ state: "ready", ...res.data });
  }, [fetchAll]);

  if (load.state === "loading") {
    return (
      <div
        role="status"
        aria-label="Loading the CV"
        className="flex flex-col gap-4"
      >
        <div className="h-7 w-1/3 rounded-sm bg-muted" />
        <div className="h-96 rounded-lg bg-muted" />
      </div>
    );
  }
  if (load.state === "error") {
    return load.notFound ? (
      <EmptyState title="CV not found.">
        The candidate may have been merged into another, or the link is wrong.
      </EmptyState>
    ) : (
      <section
        role="alert"
        className="rounded-lg border border-border bg-card px-5 py-6"
      >
        <h2>The CV could not load</h2>
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
    );
  }

  const { candidate: c, info } = load;
  const cv = c.cvs.find((x) => x.id === cvId);
  if (!cv) {
    return (
      <EmptyState title="CV not found.">
        This file is not on the candidate any more.
      </EmptyState>
    );
  }
  const app = info.application;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2 border-b border-border pb-4">
        <Link
          href={`/requisitions/${app.requisition.id}?tab=candidates`}
          className="text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          Back to {formatReqNumber(app.requisition.number)},{" "}
          {app.requisition.title}
        </Link>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="num text-sm text-muted-foreground">{c.code}</span>
          <h1>{c.name}</h1>
          {info.score && <BandLabel band={info.score.band} />}
        </div>
        <p className="text-muted-foreground">
          <Link
            href={`/candidates/${c.id}`}
            className="underline underline-offset-4 hover:no-underline"
          >
            Profile
          </Link>
          , {c.currentRole ?? "current role not stated"}
        </p>
      </header>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,25rem)]">
        <CvPane
          cvId={cvId}
          fileName={cv.fileName}
          requisitionId={app.requisition.id}
          quotes={
            info.score?.criteria.flatMap((q) =>
              q.quotes.filter((x) => x.verified).map((x) => x.text),
            ) ?? []
          }
          pick={pick}
          onOpened={refreshInfo}
        />
        <aside
          aria-label="Score and decision"
          className="flex min-w-0 flex-col gap-6 lg:sticky lg:top-6 lg:max-h-[calc(100vh-3rem)] lg:self-start lg:overflow-y-auto"
        >
          <ScoreSide info={info} onPick={(quote) => setPick({ quote })} />
          <Decision info={app} canDecide={canDecide} onChanged={refreshInfo} />
        </aside>
      </div>
    </div>
  );
}

function ScoreSide({
  info,
  onPick,
}: {
  info: ScoreResponse;
  onPick: (quote: string) => void;
}) {
  if (info.score) return <ScorePanel score={info.score} onPick={onPick} />;
  if (!info.application.scorecardConfirmed) {
    return (
      <p className="text-sm text-muted-foreground">
        Confirm the scorecard to rank candidates.
      </p>
    );
  }
  if (info.state === "SCORED") return null;
  return (
    <p className="text-sm text-muted-foreground">
      {pendingLabel(info.state)}. The breakdown appears here when it is done.
    </p>
  );
}

function CvPane({
  cvId,
  fileName,
  requisitionId,
  quotes,
  pick,
  onOpened,
}: {
  cvId: string;
  fileName: string;
  requisitionId: string;
  quotes: string[];
  pick: { quote: string } | null;
  onOpened: () => void;
}) {
  const isPdf = /\.pdf$/i.test(fileName);
  const [mode, setMode] = useState<"original" | "text">(
    isPdf ? "original" : "text",
  );
  const [text, setText] = useState<
    | { state: "idle" | "loading" }
    | { state: "error"; message: string }
    | { state: "ready"; data: CvText }
  >({ state: "idle" });
  const box = useRef<HTMLDivElement>(null);
  const [picked, setPicked] = useState<string | null>(null);

  // Picking a quote in the breakdown jumps to it in the text view.
  const [seen, setSeen] = useState(pick);
  if (pick !== seen) {
    setSeen(pick);
    setMode("text");
    setPicked(pick?.quote ?? null);
  }

  useEffect(() => {
    if (mode !== "text" || text.state !== "idle") return;
    let current = true;
    void api<CvText>(`/api/cvs/${cvId}/text?requisition=${requisitionId}`).then(
      (res) => {
        if (!current) return;
        if (res.ok) {
          setText({ state: "ready", data: res.data });
          onOpened();
        } else {
          setText({ state: "error", message: res.error });
        }
      },
    );
    return () => {
      current = false;
    };
  }, [mode, text.state, cvId, requisitionId, onOpened]);

  useEffect(() => {
    if (text.state !== "ready" || !picked) return;
    const mark = [...(box.current?.querySelectorAll("mark") ?? [])].find(
      (m) => (m as HTMLElement).dataset.quote === picked,
    );
    mark?.scrollIntoView({ block: "center" });
  }, [text.state, picked, mode]);

  const shown =
    text.state === "ready" ? segments(text.data.text, quotes) : null;

  return (
    <section aria-label="CV" className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {isPdf && (
          <>
            <Button
              size="sm"
              variant={mode === "original" ? "default" : "outline"}
              aria-pressed={mode === "original"}
              onClick={() => setMode("original")}
            >
              Original
            </Button>
            <Button
              size="sm"
              variant={mode === "text" ? "default" : "outline"}
              aria-pressed={mode === "text"}
              onClick={() => {
                setPicked(null);
                setMode("text");
              }}
            >
              Text
            </Button>
          </>
        )}
        <span className="min-w-0 break-words text-sm text-muted-foreground">
          {fileName}
        </span>
      </div>

      {mode === "original" && isPdf && (
        <iframe
          title={`CV file ${fileName}`}
          src={`/api/cvs/${cvId}/file?requisition=${requisitionId}`}
          onLoad={onOpened}
          className="h-[70vh] w-full rounded-md border border-border bg-card lg:h-[80vh]"
        />
      )}

      {mode === "text" && (
        <div ref={box} className="flex flex-col gap-3">
          {text.state === "error" && (
            <p
              role="alert"
              className="rounded-md bg-destructive-soft px-4 py-3 text-sm text-destructive"
            >
              {text.message}
            </p>
          )}
          {text.state !== "ready" && text.state !== "error" && (
            <div
              role="status"
              aria-label="Loading the text"
              className="h-64 rounded-md bg-muted"
            />
          )}
          {text.state === "ready" && shown && (
            <>
              {text.data.textSource === "OCR" && (
                <p className="rounded-md bg-review-soft px-4 py-3 text-sm text-review">
                  Read from a scanned image with OCR
                  {text.data.ocrConfidence === null
                    ? ""
                    : `, ${Math.round(text.data.ocrConfidence)}% confidence`}
                  . Words may be misread, so check the original.
                </p>
              )}
              {shown.located < quotes.length && (
                <p className="text-sm text-muted-foreground">
                  {quotes.length - shown.located} of {quotes.length} quotes
                  could not be placed in this view.
                </p>
              )}
              <div className="whitespace-pre-wrap break-words rounded-md border border-border bg-card px-4 py-4 text-sm leading-relaxed">
                {shown.parts.map((p, i) =>
                  p.quote ? (
                    <mark
                      key={i}
                      data-quote={p.quote}
                      className={`rounded-sm px-0.5 text-foreground ${picked === p.quote ? "bg-primary" : "bg-primary-soft"}`}
                    >
                      {p.text}
                    </mark>
                  ) : (
                    <span key={i}>{p.text}</span>
                  ),
                )}
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}

function Decision({
  info,
  canDecide,
  onChanged,
}: {
  info: ApplicationInfo;
  canDecide: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState<RejectReason>("SKILLS_GAP");
  const [note, setNote] = useState("");

  async function send(path: string, json?: unknown) {
    setBusy(true);
    setProblem(null);
    const res = await api<{ ok: true }>(
      `/api/applications/${info.id}/${path}`,
      { json: json ?? {} },
    );
    setBusy(false);
    if (res.ok) {
      setRejecting(false);
      onChanged();
    } else {
      setProblem(res.error);
    }
  }

  const stage = STAGE_LABEL[info.stage] ?? info.stage;
  const open = info.stage === "SOURCED" || info.stage === "SCREENED";

  return (
    <section
      aria-labelledby="decision-heading"
      className="flex flex-col gap-3 border-t border-border pt-4"
    >
      <h2 id="decision-heading" className="text-lg">
        Decision
      </h2>
      <p className="text-sm">
        Stage: <span className="font-medium">{stage}</span>
        {info.stage === "REJECTED" && !info.clientRejection && (
          <>
            , {rejectLabel(info.rejectReason)}
            {info.rejectNote ? `: ${info.rejectNote}` : ""}
          </>
        )}
      </p>
      {info.clientRejection && (
        <p className="text-sm font-medium">
          {clientDecisionText(info.clientRejection)}
        </p>
      )}
      {info.submissionNote && info.stage !== "SCREENED" && (
        <p className="text-sm">
          <span className="font-medium">Note to client:</span>{" "}
          {info.submissionNote}
        </p>
      )}
      {canDecide && (
        <PipelineActions
          applicationId={info.id}
          stage={info.stage as Stage}
          onChanged={onChanged}
        />
      )}
      {problem && (
        <p
          role="alert"
          className="rounded-md bg-destructive-soft px-4 py-3 text-sm text-destructive"
        >
          {problem}
        </p>
      )}

      {canDecide && info.stage === "SOURCED" && (
        <div className="flex flex-col gap-2">
          <Button
            disabled={!info.cvViewed || busy}
            aria-describedby={info.cvViewed ? undefined : "gate-note"}
            onClick={() => void send("screen")}
          >
            Mark screened
          </Button>
          {!info.cvViewed && (
            <p id="gate-note" className="text-sm text-muted-foreground">
              {SCREEN_GATE_MESSAGE}
            </p>
          )}
        </div>
      )}

      {canDecide && open && !rejecting && (
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => setRejecting(true)}
        >
          Not a fit
        </Button>
      )}

      {canDecide && open && rejecting && (
        <form
          className="flex flex-col gap-3 rounded-md bg-muted px-4 py-4"
          onSubmit={(e) => {
            e.preventDefault();
            void send("reject", { reason, note: note.trim() || undefined });
          }}
        >
          <div className="flex flex-col gap-1">
            <FieldLabel htmlFor="reject-reason">Reason</FieldLabel>
            <Select
              id="reject-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value as RejectReason)}
            >
              {REJECT_REASONS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </div>
          {reason === "OTHER" && (
            <div className="flex flex-col gap-1">
              <FieldLabel htmlFor="reject-note">Say why</FieldLabel>
              <Input
                id="reject-note"
                value={note}
                maxLength={500}
                required
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={busy}>
              Confirm not a fit
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => setRejecting(false)}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}

      {canDecide &&
        info.stage === "REJECTED" &&
        !info.clientRejection &&
        info.submissionNote === null && (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void send("reopen")}
          >
            Move back to sourced
          </Button>
        )}

      {!canDecide && (
        <p className="text-sm text-muted-foreground">
          Only recruiters can change a candidate&apos;s stage.
        </p>
      )}
    </section>
  );
}
