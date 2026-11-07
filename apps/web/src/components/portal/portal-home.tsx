"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { formatReqNumber, type PortalRequisition } from "@hireproof/shared";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { api } from "@/lib/api";

type Load =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; items: PortalRequisition[] };

export function PortalHome() {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    void api<PortalRequisition[]>("/api/portal/requisitions").then((res) => {
      if (!current) return;
      setLoad(
        res.ok
          ? { state: "ready", items: res.data }
          : { state: "error", message: res.error },
      );
    });
    return () => {
      current = false;
    };
  }, [attempt]);

  return (
    <div className="flex flex-col gap-6">
      <h1>Your requisitions</h1>

      {load.state === "loading" && (
        <div
          role="status"
          aria-label="Loading your requisitions"
          className="flex flex-col"
        >
          {[0, 1, 2].map((n) => (
            <div
              key={n}
              className="flex flex-col gap-2 border-b border-border py-4"
            >
              <div className="h-5 w-2/3 rounded-sm bg-muted" />
              <div className="h-4 w-1/2 rounded-sm bg-muted" />
            </div>
          ))}
        </div>
      )}

      {load.state === "error" && (
        <section
          role="alert"
          className="rounded-lg border border-border bg-card px-5 py-6"
        >
          <h2>Your requisitions could not load</h2>
          <p className="mt-1 text-muted-foreground">{load.message}</p>
          <Button
            variant="outline"
            size="lg"
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

      {load.state === "ready" && load.items.length === 0 && (
        <EmptyState title="Nothing to review yet.">
          Your recruiter will submit candidates here.
        </EmptyState>
      )}

      {load.state === "ready" && load.items.length > 0 && (
        <ul className="flex flex-col border-t border-border">
          {load.items.map((r) => (
            <li key={r.id} className="border-b border-border">
              <Link
                href={`/portal/requisitions/${r.id}`}
                className="flex flex-col gap-1 py-4 hover:bg-accent md:px-3"
              >
                <span className="flex items-baseline justify-between gap-3">
                  <span className="font-display text-lg font-semibold">
                    {r.title}
                  </span>
                  <span className="num shrink-0 text-sm text-muted-foreground">
                    {formatReqNumber(r.number)}
                  </span>
                </span>
                {r.counts.submitted === 0 ? (
                  <span className="text-sm text-muted-foreground">
                    No candidates submitted yet.
                  </span>
                ) : (
                  <span className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
                    {r.counts.awaitingReview > 0 && (
                      <span className="font-medium">
                        <span className="num">{r.counts.awaitingReview}</span>{" "}
                        awaiting your review
                      </span>
                    )}
                    <span>
                      <span className="num">{r.counts.submitted}</span>{" "}
                      submitted
                    </span>
                    <span>
                      <span className="num">{r.counts.shortlisted}</span>{" "}
                      shortlisted
                    </span>
                    <span>
                      <span className="num">{r.counts.interviews}</span>{" "}
                      {r.counts.interviews === 1 ? "interview" : "interviews"}
                    </span>
                  </span>
                )}
                {r.status !== "OPEN" && (
                  <span className="text-sm text-muted-foreground">
                    {r.status === "ON_HOLD" ? "On hold" : "Closed"}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
