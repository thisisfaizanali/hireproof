"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  RETENTION_MONTHS,
  deletionReasonLabel,
  type DataPage as DataPageView,
  type DeletionCounts,
} from "@hireproof/shared";
import { EmptyState } from "@/components/empty-state";
import { formatDate, formatStamp } from "@/components/status";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";

type Load =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; data: DataPageView };

const COUNT_NAMES: [keyof DeletionCounts, string, string][] = [
  ["cvs", "CV", "CVs"],
  ["applications", "application", "applications"],
  ["scores", "score", "scores"],
  ["slots", "interview time", "interview times"],
  ["messages", "message", "messages"],
  ["consentRecords", "consent record", "consent records"],
  ["duplicateLinks", "duplicate link", "duplicate links"],
];

const removed = (counts: DeletionCounts) =>
  COUNT_NAMES.filter(([key]) => counts[key] > 0)
    .map(
      ([key, one, many]) => `${counts[key]} ${counts[key] === 1 ? one : many}`,
    )
    .join(", ") || "Nothing else";

export function DataPage() {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    void api<DataPageView>("/api/data/retention").then((res) => {
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
  }, [attempt]);

  return (
    <div className="flex flex-col gap-10">
      <header className="flex flex-col gap-2 border-b border-border pb-4">
        <h1>Data</h1>
        <p className="text-sm text-muted-foreground">
          Candidates are kept for {RETENTION_MONTHS} months after their last CV
          upload or stage change. Nothing is deleted automatically.
        </p>
      </header>

      {load.state === "loading" && (
        <div
          role="status"
          aria-label="Loading data"
          className="flex flex-col gap-4"
        >
          <div className="h-5 w-1/2 rounded-sm bg-muted" />
          <div className="h-32 rounded-lg bg-muted" />
        </div>
      )}

      {load.state === "error" && (
        <section
          role="alert"
          className="rounded-lg border border-border bg-card px-5 py-6"
        >
          <h2>The data page could not load</h2>
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

      {load.state === "ready" && <Ready data={load.data} />}
    </div>
  );
}

function Ready({ data }: { data: DataPageView }) {
  return (
    <>
      <section
        aria-labelledby="expired-heading"
        className="flex flex-col gap-4"
      >
        <h2 id="expired-heading">Past their retention date</h2>
        {data.expired.length === 0 ? (
          <EmptyState title="No candidate is past their retention date.">
            A candidate appears here {RETENTION_MONTHS} months after their last
            activity.
          </EmptyState>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              <span className="num">{data.expiredTotal}</span>{" "}
              {data.expiredTotal === 1 ? "candidate has" : "candidates have"}{" "}
              not been active for more than {RETENTION_MONTHS} months. Open a
              profile to delete their data.
            </p>
            <table className="hidden w-full border-collapse text-sm md:table">
              <caption className="visually-hidden">
                Candidates past retention
              </caption>
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  {["Code", "Name", "Last activity", "Keep until"].map((h) => (
                    <th key={h} scope="col" className="py-2 pr-4 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.expired.map((c) => (
                  <tr
                    key={c.id}
                    className="border-b border-border hover:bg-accent"
                  >
                    <td className="num py-3 pr-4">
                      <Link
                        href={`/candidates/${c.id}`}
                        className="underline underline-offset-4 hover:no-underline"
                      >
                        {c.code}
                      </Link>
                    </td>
                    <td className="py-3 pr-4">{c.name}</td>
                    <td className="py-3 pr-4 text-muted-foreground">
                      {formatDate(c.lastActivityAt)}
                    </td>
                    <td className="py-3 pr-4 text-muted-foreground">
                      {formatDate(c.retainUntil)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ul className="flex flex-col border-t border-border md:hidden">
              {data.expired.map((c) => (
                <li key={c.id} className="border-b border-border">
                  <Link
                    href={`/candidates/${c.id}`}
                    className="flex flex-col gap-1 py-3"
                  >
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="font-medium">{c.name}</span>
                      <span className="num text-sm text-muted-foreground">
                        {c.code}
                      </span>
                    </span>
                    <span className="text-sm text-muted-foreground">
                      Last active {formatDate(c.lastActivityAt)}, keep until{" "}
                      {formatDate(c.retainUntil)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section
        aria-labelledby="deleted-heading"
        className="flex flex-col gap-4"
      >
        <h2 id="deleted-heading">Recent deletions</h2>
        {data.deletions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No candidate data has been deleted.
          </p>
        ) : (
          <>
            <table className="hidden w-full border-collapse text-sm md:table">
              <caption className="visually-hidden">Recent deletions</caption>
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  {[
                    "Code",
                    "Reason",
                    "Deleted by",
                    "When (IST)",
                    "What was removed",
                  ].map((h) => (
                    <th key={h} scope="col" className="py-2 pr-4 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.deletions.map((d) => (
                  <tr key={d.id} className="border-b border-border">
                    <td className="num py-3 pr-4">{d.candidateCode}</td>
                    <td className="py-3 pr-4">
                      {deletionReasonLabel(d.reason)}
                    </td>
                    <td className="py-3 pr-4">{d.deletedBy}</td>
                    <td className="num py-3 pr-4 text-muted-foreground">
                      {formatStamp(d.deletedAt)}
                    </td>
                    <td className="py-3 pr-4 text-muted-foreground">
                      {removed(d.counts)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ul className="flex flex-col border-t border-border md:hidden">
              {data.deletions.map((d) => (
                <li
                  key={d.id}
                  className="flex flex-col gap-1 border-b border-border py-3 text-sm"
                >
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="num font-medium">{d.candidateCode}</span>
                    <span>{deletionReasonLabel(d.reason)}</span>
                  </span>
                  <span className="text-muted-foreground">
                    {d.deletedBy}, {formatStamp(d.deletedAt)}
                  </span>
                  <span className="text-muted-foreground">
                    {removed(d.counts)}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </>
  );
}
