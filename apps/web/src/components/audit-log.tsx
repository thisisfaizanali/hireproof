"use client";

import { useEffect, useState } from "react";
import { AUDIT_ACTIONS, type AuditPageView } from "@hireproof/shared";
import { EmptyState } from "@/components/empty-state";
import { formatStamp } from "@/components/status";
import { Button } from "@/components/ui/button";
import { FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { api } from "@/lib/api";

interface Filters {
  person: string;
  action: string;
  from: string;
  to: string;
  subject: string;
}

const NONE: Filters = { person: "", action: "", from: "", to: "", subject: "" };

type Load =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; data: AuditPageView };

export function AuditLog() {
  const [draft, setDraft] = useState<Filters>(NONE);
  const [applied, setApplied] = useState<Filters>(NONE);
  const [page, setPage] = useState(1);
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);
  // The people list comes with the first page and stays for the filter.
  const [people, setPeople] = useState<AuditPageView["people"]>([]);

  useEffect(() => {
    let current = true;
    const query = new URLSearchParams({ page: String(page) });
    for (const [key, value] of Object.entries(applied)) {
      if (value) query.set(key, value);
    }
    void api<AuditPageView>(`/api/audit?${query}`).then((res) => {
      if (!current) return;
      if (res.ok) {
        setPeople(res.data.people);
        setLoad({ state: "ready", data: res.data });
      } else {
        setLoad({ state: "error", message: res.error });
      }
    });
    return () => {
      current = false;
    };
  }, [applied, page, attempt]);

  const change = (key: keyof Filters) => (value: string) =>
    setDraft((d) => ({ ...d, [key]: value }));
  const filtered = Object.values(applied).some(Boolean);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2 border-b border-border pb-4">
        <h1>Audit log</h1>
        <p className="text-sm text-muted-foreground">
          Who did what, newest first. Times are in IST. The log is read only.
        </p>
      </header>

      <form
        className="grid grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-[repeat(5,minmax(0,1fr))_auto] lg:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          setLoad({ state: "loading" });
          setPage(1);
          setApplied(draft);
        }}
      >
        <div className="col-span-2 flex flex-col gap-1.5 sm:col-span-1">
          <FieldLabel htmlFor="audit-person">Person</FieldLabel>
          <Select
            id="audit-person"
            value={draft.person}
            onChange={(e) => change("person")(e.target.value)}
          >
            <option value="">Everyone</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="col-span-2 flex flex-col gap-1.5 sm:col-span-1">
          <FieldLabel htmlFor="audit-action">Action</FieldLabel>
          <Select
            id="audit-action"
            value={draft.action}
            onChange={(e) => change("action")(e.target.value)}
          >
            <option value="">Any action</option>
            {Object.entries(AUDIT_ACTIONS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <FieldLabel htmlFor="audit-from">From (IST)</FieldLabel>
          <Input
            id="audit-from"
            type="date"
            value={draft.from}
            max={draft.to || undefined}
            onChange={(e) => change("from")(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <FieldLabel htmlFor="audit-to">To (IST)</FieldLabel>
          <Input
            id="audit-to"
            type="date"
            value={draft.to}
            min={draft.from || undefined}
            onChange={(e) => change("to")(e.target.value)}
          />
        </div>
        <div className="col-span-2 flex flex-col gap-1.5 sm:col-span-1">
          <FieldLabel htmlFor="audit-subject">
            Candidate or requisition
          </FieldLabel>
          <Input
            id="audit-subject"
            placeholder="CND-10137 or REQ-0009"
            value={draft.subject}
            maxLength={40}
            onChange={(e) => change("subject")(e.target.value)}
          />
        </div>
        <div className="flex gap-2">
          <Button type="submit">Show events</Button>
          {(filtered || Object.values(draft).some(Boolean)) && (
            <Button
              variant="ghost"
              onClick={() => {
                setDraft(NONE);
                setApplied(NONE);
                setPage(1);
                setLoad({ state: "loading" });
              }}
            >
              Clear
            </Button>
          )}
        </div>
      </form>

      {load.state === "loading" && (
        <div
          role="status"
          aria-label="Loading the audit log"
          className="flex flex-col"
        >
          {[0, 1, 2, 3, 4].map((n) => (
            <div
              key={n}
              className="flex items-center gap-4 border-b border-border py-4"
            >
              <div className="h-4 w-32 rounded-sm bg-muted" />
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
          <h2>The audit log could not load</h2>
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

      {load.state === "ready" && <Events data={load.data} onPage={setPage} />}
    </div>
  );
}

function Events({
  data,
  onPage,
}: {
  data: AuditPageView;
  onPage: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  return (
    <>
      {data.subjectNote && (
        <p
          role="status"
          className="rounded-md bg-warning-soft px-4 py-3 text-sm text-warning"
        >
          {data.subjectNote}
        </p>
      )}
      {data.rows.length === 0 ? (
        <EmptyState title="No events match.">
          Change or clear the filters to see more.
        </EmptyState>
      ) : (
        <>
          <table className="hidden w-full border-collapse text-sm md:table">
            <caption className="visually-hidden">
              Audit events, newest first
            </caption>
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th scope="col" className="w-52 py-2 pr-4 font-medium">
                  Time (IST)
                </th>
                <th scope="col" className="w-32 py-2 pr-4 font-medium">
                  Person
                </th>
                <th scope="col" className="py-2 pr-4 font-medium">
                  What happened
                </th>
                <th scope="col" className="w-28 py-2 font-medium">
                  Address
                </th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr
                  key={r.id}
                  className="border-b border-border hover:bg-accent"
                >
                  <td className="num py-2.5 pr-4 text-muted-foreground">
                    {formatStamp(r.at)}
                  </td>
                  <td className="py-2.5 pr-4">{r.person ?? "Not signed in"}</td>
                  <td className="py-2.5 pr-4">{r.sentence}</td>
                  <td className="num py-2.5 text-muted-foreground">
                    {r.ip ?? "Not recorded"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <ul className="flex flex-col border-t border-border md:hidden">
            {data.rows.map((r) => (
              <li
                key={r.id}
                className="flex flex-col gap-1 border-b border-border py-3"
              >
                <span className="text-sm">{r.sentence}</span>
                <span className="num text-sm text-muted-foreground">
                  {formatStamp(r.at)}
                </span>
                <span className="num text-sm text-muted-foreground">
                  Address {r.ip ?? "not recorded"}
                </span>
              </li>
            ))}
          </ul>

          <nav
            aria-label="Pages"
            className="flex flex-wrap items-center justify-between gap-3"
          >
            <p className="text-sm text-muted-foreground">
              Page <span className="num">{data.page}</span> of{" "}
              <span className="num">{pages}</span>,{" "}
              <span className="num">{data.total.toLocaleString("en-IN")}</span>{" "}
              events
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                disabled={data.page <= 1}
                onClick={() => onPage(data.page - 1)}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                disabled={data.page >= pages}
                onClick={() => onPage(data.page + 1)}
              >
                Next
              </Button>
            </div>
          </nav>
        </>
      )}
    </>
  );
}
