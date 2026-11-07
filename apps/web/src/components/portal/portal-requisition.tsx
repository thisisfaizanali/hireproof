"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  constraintFlags,
  formatReqNumber,
  type PortalCandidateList,
  type PortalCandidateRow,
} from "@hireproof/shared";
import { ConstraintFlagList } from "@/components/constraint-flags";
import { EmptyState } from "@/components/empty-state";
import { BandLabel } from "@/components/score";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { PORTAL_FILTERS, noticePhrase, stageText } from "@/lib/portal";

type Load =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; data: PortalCandidateList };

const countFor = (items: PortalCandidateRow[], stages: string[]) =>
  items.filter((i) => stages.includes(i.stage)).length;

export function PortalRequisition({ id }: { id: string }) {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [filter, setFilter] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    void api<PortalCandidateList>(
      `/api/portal/requisitions/${id}/candidates`,
    ).then((res) => {
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
  }, [id, attempt]);

  if (load.state === "loading") {
    return (
      <div
        role="status"
        aria-label="Loading candidates"
        className="flex flex-col"
      >
        {[0, 1, 2].map((n) => (
          <div
            key={n}
            className="flex flex-col gap-2 border-b border-border py-4"
          >
            <div className="h-5 w-1/2 rounded-sm bg-muted" />
            <div className="h-4 w-3/4 rounded-sm bg-muted" />
            <div className="h-4 w-1/3 rounded-sm bg-muted" />
          </div>
        ))}
      </div>
    );
  }

  if (load.state === "error") {
    return (
      <section
        role="alert"
        className="rounded-lg border border-border bg-card px-5 py-6"
      >
        <h2>Candidates could not load</h2>
        <p className="mt-1 text-muted-foreground">{load.message}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="lg"
            onClick={() => {
              setLoad({ state: "loading" });
              setAttempt((n) => n + 1);
            }}
          >
            Try again
          </Button>
          <Button asChild variant="ghost" size="lg">
            <Link href="/portal">Back to your requisitions</Link>
          </Button>
        </div>
      </section>
    );
  }

  const { requisition, items, counts } = load.data;
  const active = filter ?? (counts.awaitingReview > 0 ? "awaiting" : "all");
  const current = PORTAL_FILTERS.find((f) => f.key === active)!;
  const shown = items.filter((i) => current.stages.includes(i.stage));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link
          href="/portal"
          className="w-fit text-sm underline underline-offset-4 hover:no-underline"
        >
          Your requisitions
        </Link>
        <h1>{requisition.title}</h1>
        <p className="num text-sm text-muted-foreground">
          {formatReqNumber(requisition.number)}
        </p>
      </div>

      {items.length === 0 ? (
        <EmptyState title="Nothing to review yet.">
          Your recruiter will submit candidates here.
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-6 md:grid md:grid-cols-[13rem_minmax(0,1fr)] md:items-start md:gap-10">
          <div
            role="group"
            aria-label="Show candidates"
            className="flex flex-wrap gap-2 md:flex-col md:gap-1"
          >
            {PORTAL_FILTERS.map((f) => {
              const n = countFor(items, f.stages);
              const on = f.key === active;
              return (
                <button
                  key={f.key}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setFilter(f.key)}
                  className={`flex h-11 items-center justify-between gap-3 rounded-md border px-3 text-sm font-medium transition-colors duration-(--dur-micro) md:w-full ${
                    on
                      ? "border-transparent bg-primary-soft"
                      : "border-input bg-card hover:bg-accent md:border-transparent md:bg-transparent"
                  }`}
                >
                  {f.label}
                  <span className="num">{n}</span>
                </button>
              );
            })}
          </div>

          <div className="flex min-w-0 flex-col gap-3" aria-live="polite">
            {shown.length === 0 ? (
              <EmptyState
                title={`No candidates under ${current.label.toLowerCase()}.`}
              >
                Pick another filter to see the rest.
              </EmptyState>
            ) : (
              <ul className="flex flex-col border-t border-border">
                {shown.map((c) => (
                  <Row key={c.applicationId} c={c} />
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ c }: { c: PortalCandidateRow }) {
  const flags = constraintFlags(c.flags);
  return (
    <li className="border-b border-border">
      <Link
        href={`/portal/applications/${c.applicationId}`}
        className="flex flex-col gap-1.5 py-4 hover:bg-accent md:px-3"
      >
        <span className="flex items-baseline justify-between gap-3">
          <span className="text-md font-medium">{c.name}</span>
          <span
            className={`shrink-0 text-sm ${c.stage === "SUBMITTED" ? "font-medium" : "text-muted-foreground"}`}
          >
            {stageText(c)}
          </span>
        </span>
        <span className="text-sm text-muted-foreground">
          {c.currentRole ?? "Role not stated"}
        </span>
        <span className="text-sm">
          {c.totalExperienceYears === null ? (
            "Experience not stated"
          ) : (
            <>
              <span className="num">{c.totalExperienceYears}</span> years
            </>
          )}
          , {noticePhrase(c.noticeText, c.noticeDays)},{" "}
          {c.location ?? "location not stated"}
        </span>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          {c.band && <BandLabel band={c.band} />}
          {c.mustHavesTotal > 0 && (
            <span className="text-sm">
              <span className="num">{c.mustHavesMet}</span> of{" "}
              <span className="num">{c.mustHavesTotal}</span> must-haves
            </span>
          )}
          <ConstraintFlagList flags={flags} />
        </span>
      </Link>
    </li>
  );
}
