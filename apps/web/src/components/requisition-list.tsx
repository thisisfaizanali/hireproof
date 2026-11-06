"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  formatReqNumber,
  type ClientSummary,
  type RequisitionStatus,
  type RequisitionSummary,
} from "@hireproof/shared";
import { EmptyState } from "@/components/empty-state";
import {
  RequisitionStatusLabel,
  STATUS_LABEL,
  ScorecardStatusLabel,
  formatDate,
} from "@/components/status";
import { Button } from "@/components/ui/button";
import { FieldLabel } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { api } from "@/lib/api";

const STATUSES: RequisitionStatus[] = ["DRAFT", "OPEN", "ON_HOLD", "CLOSED"];

type Load =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; rows: RequisitionSummary[] };

export function RequisitionList({ canCreate }: { canCreate: boolean }) {
  const [status, setStatus] = useState("");
  const [clientId, setClientId] = useState("");
  const [mine, setMine] = useState(false);
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    void api<ClientSummary[]>("/api/clients").then((res) => {
      if (res.ok) setClients(res.data);
    });
  }, []);

  useEffect(() => {
    let current = true;
    const query = new URLSearchParams();
    if (status) query.set("status", status);
    if (clientId) query.set("clientId", clientId);
    if (mine) query.set("mine", "true");
    void api<RequisitionSummary[]>(`/api/requisitions?${query}`).then((res) => {
      if (!current) return;
      setLoad(
        res.ok
          ? { state: "ready", rows: res.data }
          : { state: "error", message: res.error },
      );
    });
    return () => {
      current = false;
    };
  }, [status, clientId, mine, attempt]);

  const filtered = status !== "" || clientId !== "" || mine;
  const change = (apply: () => void) => {
    setLoad({ state: "loading" });
    apply();
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1>Requisitions</h1>
        {canCreate && (
          <Button asChild>
            <Link href="/requisitions/new">New requisition</Link>
          </Button>
        )}
      </div>

      <form
        className="flex flex-wrap items-end gap-4"
        onSubmit={(event) => event.preventDefault()}
        aria-label="Filter requisitions"
      >
        <div className="flex w-full flex-col gap-1.5 sm:w-44">
          <FieldLabel htmlFor="filter-status">Status</FieldLabel>
          <Select
            id="filter-status"
            value={status}
            onChange={(e) => change(() => setStatus(e.target.value))}
          >
            <option value="">All</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex w-full flex-col gap-1.5 sm:w-56">
          <FieldLabel htmlFor="filter-client">Client</FieldLabel>
          <Select
            id="filter-client"
            value={clientId}
            onChange={(e) => change(() => setClientId(e.target.value))}
          >
            <option value="">All</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
        {canCreate && (
          <label className="flex h-10 items-center gap-2 text-sm font-medium pointer-coarse:h-11">
            <input
              type="checkbox"
              className="size-4 accent-[var(--color-primary)]"
              checked={mine}
              onChange={(e) => change(() => setMine(e.target.checked))}
            />
            Mine
          </label>
        )}
      </form>

      {load.state === "loading" && <Skeleton />}

      {load.state === "error" && (
        <section
          role="alert"
          className="rounded-lg border border-border bg-card px-5 py-6"
        >
          <h2>Requisitions could not load</h2>
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

      {load.state === "ready" && load.rows.length === 0 && (
        <EmptyState
          title={filtered ? "No requisitions match." : "No requisitions yet."}
        >
          {filtered
            ? "Change or clear the filters to see more."
            : "A requisition appears here once a recruiter adds a job description."}
        </EmptyState>
      )}

      {load.state === "ready" && load.rows.length > 0 && (
        <>
          <table className="hidden w-full border-collapse text-sm md:table">
            <caption className="visually-hidden">Requisitions</caption>
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                {[
                  "Requisition",
                  "Title",
                  "Client",
                  "Status",
                  "Scorecard",
                  "Owner",
                  "Created",
                ].map((head) => (
                  <th key={head} scope="col" className="py-2 pr-4 font-medium">
                    {head}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {load.rows.map((row) => (
                <tr
                  key={row.id}
                  className="border-b border-border hover:bg-accent"
                >
                  <td className="num py-3 pr-4">
                    <Link
                      href={`/requisitions/${row.id}`}
                      className="underline-offset-4 hover:underline"
                    >
                      {formatReqNumber(row.number)}
                    </Link>
                  </td>
                  <td className="py-3 pr-4 font-medium">{row.title}</td>
                  <td className="py-3 pr-4">{row.client.name}</td>
                  <td className="py-3 pr-4">
                    <RequisitionStatusLabel status={row.status} />
                  </td>
                  <td className="py-3 pr-4">
                    <ScorecardStatusLabel status={row.scorecardStatus} />
                  </td>
                  <td className="py-3 pr-4">{row.owner.name}</td>
                  <td className="py-3 pr-4 text-muted-foreground">
                    {formatDate(row.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <ul className="flex flex-col border-t border-border md:hidden">
            {load.rows.map((row) => (
              <li key={row.id} className="border-b border-border">
                <Link
                  href={`/requisitions/${row.id}`}
                  className="flex flex-col gap-1.5 py-3"
                >
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="font-medium">{row.title}</span>
                    <span className="num text-sm text-muted-foreground">
                      {formatReqNumber(row.number)}
                    </span>
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {row.client.name}, owned by {row.owner.name}
                  </span>
                  <span className="flex flex-wrap items-center gap-2">
                    <RequisitionStatusLabel status={row.status} />
                    <ScorecardStatusLabel status={row.scorecardStatus} />
                    <span className="text-sm text-muted-foreground">
                      {formatDate(row.createdAt)}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function Skeleton() {
  return (
    <div
      role="status"
      aria-label="Loading requisitions"
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
  );
}
