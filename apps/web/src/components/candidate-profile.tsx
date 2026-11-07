"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  consentSourceLabel,
  formatReqNumber,
  type CandidateDetail,
  type DuplicateStatus,
} from "@hireproof/shared";
import { EmptyState } from "@/components/empty-state";
import {
  CvStatusLabel,
  Flag,
  formatPhone,
  notice,
  years,
} from "@/components/cv-status";
import { BandLabel, STAGE_LABEL } from "@/components/score";
import { formatDate } from "@/components/status";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";

const DUPLICATE_STATUS: Record<DuplicateStatus, string> = {
  AUTO_MERGED: "Attached automatically",
  PENDING: "Waiting for a recruiter",
  SAME_PERSON: "Confirmed as the same person",
  DIFFERENT_PEOPLE: "Confirmed as different people",
};

const lpa = (n: number | null) => (n === null ? null : `${n} LPA`);

type Load =
  | { state: "loading" }
  | { state: "error"; message: string; notFound: boolean }
  | { state: "ready"; data: CandidateDetail };

export function CandidateProfile({ id }: { id: string }) {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    void api<CandidateDetail>(`/api/candidates/${id}`).then((res) => {
      if (!current) return;
      setLoad(
        res.ok
          ? { state: "ready", data: res.data }
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
  }, [id, attempt]);

  if (load.state === "loading") {
    return (
      <div
        role="status"
        aria-label="Loading candidate"
        className="flex flex-col gap-4"
      >
        <div className="h-7 w-1/3 rounded-sm bg-muted" />
        <div className="h-40 rounded-lg bg-muted" />
      </div>
    );
  }
  if (load.state === "error") {
    return load.notFound ? (
      <EmptyState title="Candidate not found.">
        The candidate may have been merged into another, or the link is wrong.
      </EmptyState>
    ) : (
      <section
        role="alert"
        className="rounded-lg border border-border bg-card px-5 py-6"
      >
        <h2>The candidate could not load</h2>
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

  const c = load.data;
  const back = c.applications[0]?.requisition;
  const reviewCvs = c.cvs.filter((cv) => cv.status === "NEEDS_REVIEW");

  const facts: [string, React.ReactNode][] = [
    ["Email", c.email ?? "Not stated"],
    ["Phone", formatPhone(c.phone) ?? "Not stated"],
    ["Location", c.location ?? "Not stated"],
    ["Experience", years(c.totalExperienceYears)],
    [
      "Notice period",
      c.noticeDays !== null
        ? notice(c.noticeText, c.noticeDays)
        : (c.noticeText ?? "Not stated"),
    ],
    ["CTC as written", c.ctcText ? c.ctcText : "Not stated"],
    ["Current CTC", lpa(c.currentCtcLpa) ?? "Not stated"],
    ["Expected CTC", lpa(c.expectedCtcLpa) ?? "Not stated"],
  ];

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2 border-b border-border pb-4">
        {back && (
          <Link
            href={`/requisitions/${back.id}?tab=candidates`}
            className="text-sm text-muted-foreground underline-offset-4 hover:underline"
          >
            Back to {formatReqNumber(back.number)}, {back.title}
          </Link>
        )}
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="num text-sm text-muted-foreground">{c.code}</span>
          <h1>{c.name}</h1>
        </div>
        <p className="text-muted-foreground">
          {c.currentRole ?? "Current role not stated"}
        </p>
      </header>

      {reviewCvs.length > 0 && (
        <section
          aria-labelledby="review-heading"
          className="rounded-md bg-review-soft px-4 py-3 text-review"
        >
          <h2 id="review-heading" className="flex items-center gap-2">
            Needs review
          </h2>
          <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-sm">
            {reviewCvs.flatMap((cv) =>
              cv.reviewReasons.map((reason) => (
                <li key={`${cv.id}-${reason}`}>
                  {reason}
                  {reviewCvs.length > 1 && <span> ({cv.fileName})</span>}
                </li>
              )),
            )}
          </ul>
        </section>
      )}

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <section
          aria-labelledby="details-heading"
          className="flex min-w-0 flex-col gap-3"
        >
          <h2 id="details-heading">Details from the latest CV</h2>
          <dl className="grid grid-cols-[8rem_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
            {facts.map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="break-words">{value}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section
          aria-labelledby="skills-heading"
          className="flex min-w-0 flex-col gap-3"
        >
          <h2 id="skills-heading">Skills</h2>
          {c.skills.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No known skills were found in the CV.
            </p>
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {c.skills.map((s) => (
                <li key={s} className="rounded-sm bg-muted px-2 py-0.5 text-sm">
                  {s}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section aria-labelledby="cvs-heading" className="flex flex-col gap-3">
        <h2 id="cvs-heading">CVs</h2>
        <ul className="border-t border-border">
          {c.cvs.map((cv) => (
            <li
              key={cv.id}
              className="flex flex-col gap-1.5 border-b border-border py-3"
            >
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="break-words font-medium">{cv.fileName}</span>
                <CvStatusLabel status={cv.status} />
                {cv.textSource === "OCR" && <Flag tone="muted">Scanned</Flag>}
              </span>
              <span className="text-sm text-muted-foreground">
                {cv.textSource === "OCR"
                  ? `Read from an image with OCR${cv.ocrConfidence === null ? "" : `, ${Math.round(cv.ocrConfidence)}% confidence`}`
                  : "Read from the text in the file"}
                {cv.parseSource &&
                  `, profile by ${cv.parseSource === "AI" ? "AI" : "pattern matching"}`}
                . For {cv.requisition.title}, added {formatDate(cv.createdAt)}.
              </span>
              {cv.failureReason && (
                <span className="text-sm text-destructive">
                  {cv.failureReason}
                </span>
              )}
              {cv.reviewReasons.length > 0 && (
                <ul className="flex list-disc flex-col gap-0.5 pl-5 text-sm text-review">
                  {cv.reviewReasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="apps-heading" className="flex flex-col gap-3">
        <h2 id="apps-heading">Applications</h2>
        {c.applications.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Not applied to any requisition.
          </p>
        ) : (
          <ul className="border-t border-border">
            {c.applications.map((a) => (
              <li
                key={a.id}
                className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-border py-3"
              >
                <Link
                  href={`/requisitions/${a.requisition.id}?tab=candidates`}
                  className="underline-offset-4 hover:underline"
                >
                  <span className="num text-sm text-muted-foreground">
                    {formatReqNumber(a.requisition.number)}
                  </span>{" "}
                  <span className="font-medium">{a.requisition.title}</span>
                </Link>
                <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  {a.score && (
                    <>
                      <span className="num">{a.score.total}</span>
                      <BandLabel band={a.score.band} />
                    </>
                  )}
                  <span>{STAGE_LABEL[a.stage] ?? a.stage}</span>
                  {a.cvId && (
                    <Link
                      href={`/candidates/${c.id}/cv/${a.cvId}?requisition=${a.requisition.id}`}
                      className="underline underline-offset-4 hover:no-underline"
                    >
                      Open the CV
                    </Link>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section
        aria-labelledby="consent-heading"
        className="flex flex-col gap-3"
      >
        <h2 id="consent-heading">Consent</h2>
        {c.consents.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No consent was recorded for these CVs. They were added before
            consent was asked for.
          </p>
        ) : (
          <ul className="border-t border-border">
            {c.consents.map((k) => (
              <li
                key={k.cvId}
                className="flex flex-col gap-1 border-b border-border py-3 text-sm"
              >
                <span className="break-words font-medium">{k.fileName}</span>
                <span className="text-muted-foreground">
                  Recorded by {k.attestedBy} on {formatDate(k.attestedAt)},
                  source {consentSourceLabel(k.source).toLowerCase()}
                  {k.sourceNote ? ` (${k.sourceNote})` : ""}. They attested that
                  the candidate applied or agreed to be considered. Notice
                  version <span className="num">{k.noticeVersion}</span>.
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="dups-heading" className="flex flex-col gap-3">
        <h2 id="dups-heading">Duplicate history</h2>
        {c.duplicates.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No other CVs have matched this candidate.
          </p>
        ) : (
          <ul className="border-t border-border">
            {c.duplicates.map((d) => (
              <li
                key={d.id}
                className="flex flex-col gap-1 border-b border-border py-3 text-sm"
              >
                <span>
                  <span className="font-medium">{d.fileName}</span>: {d.reason}
                  {d.similarity !== null && d.kind === "FUZZY" && (
                    <>
                      ,{" "}
                      <span className="num">
                        {Math.round(d.similarity * 100)}%
                      </span>{" "}
                      alike
                    </>
                  )}
                  , with{" "}
                  <Link
                    href={`/candidates/${d.other.id}`}
                    className="underline underline-offset-4 hover:no-underline"
                  >
                    {d.other.name} <span className="num">{d.other.code}</span>
                  </Link>
                </span>
                <span className="text-muted-foreground">
                  {DUPLICATE_STATUS[d.status]}, {formatDate(d.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
