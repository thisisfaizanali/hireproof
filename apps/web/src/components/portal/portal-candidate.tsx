"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  CLIENT_REJECT_REASONS,
  SLOT_MINUTES,
  SLOT_MODES,
  checkSlotTime,
  constraintFlags,
  formatReqNumber,
  type ClientRejectReason,
  type PortalApplication,
  type PortalCriterion,
  type SlotMode,
} from "@hireproof/shared";
import { ConstraintFlagList } from "@/components/constraint-flags";
import { notice } from "@/components/cv-status";
import { BandLabel } from "@/components/score";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { api } from "@/lib/api";
import { CONTACT_NOTE, SLOT_STATUS, slotText, stageText } from "@/lib/portal";

type Load =
  | { state: "loading" }
  | { state: "error"; message: string; missing: boolean }
  | { state: "ready"; data: PortalApplication };

const VERDICT: Record<PortalCriterion["verdict"], string> = {
  MET: "Met",
  PARTIAL: "Partial",
  NOT_FOUND: "Not found",
};

export function PortalCandidate({ id }: { id: string }) {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [done, setDone] = useState<string | null>(null);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    let current = true;
    void api<PortalApplication>(`/api/portal/applications/${id}`).then(
      (res) => {
        if (!current) return;
        setLoad(
          res.ok
            ? { state: "ready", data: res.data }
            : {
                state: "error",
                message: res.error,
                missing: res.status === 404,
              },
        );
      },
    );
    return () => {
      current = false;
    };
  }, [id, attempt]);

  if (load.state === "loading") {
    return (
      <div
        role="status"
        aria-label="Loading the candidate"
        className="flex flex-col gap-4"
      >
        <div className="h-7 w-1/2 rounded-sm bg-muted" />
        <div className="h-4 w-2/3 rounded-sm bg-muted" />
        <div className="h-32 rounded-md bg-muted" />
      </div>
    );
  }

  if (load.state === "error") {
    return (
      <section
        role="alert"
        className="rounded-lg border border-border bg-card px-5 py-6"
      >
        <h1 className="text-lg">
          {load.missing
            ? "Candidate not found"
            : "The candidate could not load"}
        </h1>
        <p className="mt-1 text-muted-foreground">
          {load.missing
            ? "This candidate is not on your list. Go back to your requisitions."
            : load.message}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {!load.missing && (
            <Button
              variant="outline"
              size="lg"
              onClick={() => {
                setLoad({ state: "loading" });
                reload();
              }}
            >
              Try again
            </Button>
          )}
          <Button asChild variant="ghost" size="lg">
            <Link href="/portal">Your requisitions</Link>
          </Button>
        </div>
      </section>
    );
  }

  const c = load.data;
  const flags = constraintFlags(c.flags);
  const musts = c.criteria.filter((x) => x.kind === "MUST_HAVE");
  const nices = c.criteria.filter((x) => x.kind === "NICE_TO_HAVE");
  const canAct = c.stage === "SUBMITTED";
  const canPropose =
    canAct ||
    (c.stage === "CLIENT_SHORTLISTED" &&
      !c.slots.some((s) => s.status === "PROPOSED"));
  const finished = (message: string) => {
    setDone(message);
    reload();
  };

  return (
    <div className={`flex flex-col gap-6 ${canPropose ? "pb-28 md:pb-0" : ""}`}>
      <div className="flex flex-col gap-1">
        <Link
          href={`/portal/requisitions/${c.requisition.id}`}
          className="w-fit text-sm underline underline-offset-4 hover:no-underline"
        >
          {c.requisition.title}, {formatReqNumber(c.requisition.number)}
        </Link>
        <h1>{c.name}</h1>
        <p className="text-muted-foreground">
          {c.currentRole ?? "Role not stated"}
        </p>
      </div>

      {done && (
        <p
          role="status"
          className="rounded-md bg-success-soft px-4 py-3 text-sm text-success"
        >
          {done}
        </p>
      )}

      <div className="flex flex-col gap-6 md:grid md:grid-cols-[minmax(0,1fr)_20rem] md:items-start md:gap-10">
        <div className="flex min-w-0 flex-col gap-6">
          <section
            aria-labelledby="note-heading"
            className="flex flex-col gap-2"
          >
            <h2 id="note-heading" className="text-lg">
              Why this candidate
            </h2>
            <p className="rounded-md bg-muted px-4 py-3 text-md">{c.note}</p>
          </section>

          <section
            aria-labelledby="evidence-heading"
            className="flex flex-col gap-4"
          >
            <h2 id="evidence-heading" className="text-lg">
              What the CV shows
            </h2>
            <Criteria title="Must-haves" items={musts} />
            <Criteria title="Nice-to-haves" items={nices} />
            {c.criteria.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No requirements were checked for this candidate.
              </p>
            )}
          </section>

          {c.flags.length > 0 && (
            <section
              aria-labelledby="flags-heading"
              className="flex flex-col gap-2"
            >
              <h2 id="flags-heading" className="text-lg">
                Worth knowing
              </h2>
              <ul className="flex flex-col gap-1.5">
                {c.flags.map((f) => (
                  <li
                    key={f}
                    className="rounded-sm bg-warning-soft px-3 py-1.5 text-sm text-warning"
                  >
                    {f}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <details className="group border-t border-border pt-4">
            <summary className="flex min-h-11 cursor-pointer items-center text-lg font-medium">
              CV text
            </summary>
            {c.cvText ? (
              <pre className="mt-2 max-h-[32rem] overflow-auto rounded-md bg-muted px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap">
                {c.cvText}
              </pre>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">
                No text could be read from this CV. Your recruiter can send the
                original.
              </p>
            )}
          </details>
        </div>

        <aside className="flex min-w-0 flex-col gap-6 md:sticky md:top-6">
          <section
            aria-labelledby="profile-heading"
            className="flex flex-col gap-3"
          >
            <h2 id="profile-heading" className="text-lg">
              Profile
            </h2>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              {c.band && <BandLabel band={c.band} />}
              {c.mustHavesTotal > 0 && (
                <span className="text-sm">
                  <span className="num">{c.mustHavesMet}</span> of{" "}
                  <span className="num">{c.mustHavesTotal}</span> must-haves
                </span>
              )}
              <ConstraintFlagList flags={flags} />
            </div>
            <dl className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
              <Fact label="Status" value={stageText(c)} />
              <Fact
                label="Experience"
                value={
                  c.totalExperienceYears === null
                    ? "Not stated"
                    : `${c.totalExperienceYears} years`
                }
              />
              <Fact label="Notice" value={notice(c.noticeText, c.noticeDays)} />
              <Fact label="Location" value={c.location ?? "Not stated"} />
              <Fact
                label="Skills"
                value={c.skills.length > 0 ? c.skills.join(", ") : "Not stated"}
              />
              <Fact label="Reference" value={c.code} mono />
            </dl>
            <p className="text-sm text-muted-foreground">{CONTACT_NOTE}</p>
          </section>

          {c.slots.length > 0 && (
            <section
              aria-labelledby="times-heading"
              className="flex flex-col gap-2"
            >
              <h2 id="times-heading" className="text-lg">
                Interview times
              </h2>
              <ul className="flex flex-col border-t border-border">
                {c.slots.map((s) => (
                  <li
                    key={s.id}
                    className="flex flex-col gap-0.5 border-b border-border py-2 text-sm"
                  >
                    <span>{slotText(s)}</span>
                    {s.note && (
                      <span className="text-muted-foreground">{s.note}</span>
                    )}
                    <span className="font-medium">{SLOT_STATUS[s.status]}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {c.stage === "REJECTED" && c.rejection?.note && (
            <p className="text-sm text-muted-foreground">
              Your note: {c.rejection.note}
            </p>
          )}

          {canPropose && (
            <ActionBar
              id={c.applicationId}
              canShortlist={canAct}
              onDone={finished}
            />
          )}
          {!canPropose && c.stage === "CLIENT_SHORTLISTED" && (
            <p className="text-sm text-muted-foreground">
              Your recruiter will confirm one of the times you proposed.
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}

function Fact({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={`break-words ${mono ? "num" : ""}`}>{value}</dd>
    </>
  );
}

function Criteria({
  title,
  items,
}: {
  title: string;
  items: PortalCriterion[];
}) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-sm font-medium text-muted-foreground">{title}</h3>
      <ul className="border-t border-border">
        {items.map((c) => (
          <li
            key={c.label}
            className="flex flex-col gap-1.5 border-b border-border py-2.5"
          >
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 break-words font-medium">{c.label}</span>
              <span
                className={`shrink-0 text-sm ${c.verdict === "NOT_FOUND" ? "text-muted-foreground" : "font-medium"}`}
              >
                {VERDICT[c.verdict]}
              </span>
            </div>
            {c.quotes.map((q) => (
              <blockquote
                key={q}
                className="rounded-sm border-l-2 border-primary bg-primary-soft px-3 py-1.5 text-sm"
              >
                {q}
              </blockquote>
            ))}
          </li>
        ))}
      </ul>
    </div>
  );
}

// Fixed to the bottom edge on a phone, inline beside the profile from 48rem.
function ActionBar({
  id,
  canShortlist,
  onDone,
}: {
  id: string;
  canShortlist: boolean;
  onDone: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function shortlist() {
    setBusy(true);
    setProblem(null);
    const res = await api<{ ok: true }>(
      `/api/portal/applications/${id}/shortlist`,
      { method: "POST", json: {} },
    );
    setBusy(false);
    if (res.ok) onDone("Shortlisted. Your recruiter has been told.");
    else setProblem(res.error);
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-20 flex flex-col gap-2 border-t border-border bg-card px-(--gutter) py-3 md:static md:border-0 md:bg-transparent md:p-0">
      {problem && (
        <p role="alert" className="text-sm text-destructive">
          {problem}
        </p>
      )}
      <div className="mx-auto flex w-full max-w-5xl gap-2 md:flex-col">
        {canShortlist && (
          <Button
            size="lg"
            className="flex-1"
            disabled={busy}
            onClick={() => void shortlist()}
          >
            Shortlist
          </Button>
        )}
        <ProposeTimes id={id} onDone={onDone} />
        {canShortlist && <RejectCandidate id={id} onDone={onDone} />}
      </div>
    </div>
  );
}

function RejectCandidate({
  id,
  onDone,
}: {
  id: string;
  onDone: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ClientRejectReason | "">("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!reason) {
      setError("Choose a reason");
      return;
    }
    if (reason === "OTHER" && !note.trim()) {
      setError("Say why in a few words");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await api<{ ok: true }>(
      `/api/portal/applications/${id}/reject`,
      {
        json: { reason, note: note.trim() || undefined },
      },
    );
    setBusy(false);
    if (res.ok) {
      setOpen(false);
      onDone("Rejected. Your recruiter has been told.");
    } else {
      setError(res.error);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        size="lg"
        variant="outline"
        className="flex-1"
        onClick={() => setOpen(true)}
      >
        Reject
      </Button>
      <DialogContent
        title="Reject this candidate"
        description="Your recruiter sees the reason. You cannot undo this yourself, but you can ask your recruiter."
      >
        <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
          <fieldset className="flex flex-col gap-1">
            <legend className="mb-1 text-sm font-medium">Reason</legend>
            {CLIENT_REJECT_REASONS.map(([value, label]) => (
              <label
                key={value}
                className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border border-border px-3 has-[:checked]:border-transparent has-[:checked]:bg-primary-soft has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring"
              >
                <input
                  type="radio"
                  name="reject-reason"
                  value={value}
                  checked={reason === value}
                  onChange={() => {
                    setReason(value);
                    setError(null);
                  }}
                  className="size-4 accent-[var(--color-foreground)]"
                />
                {label}
              </label>
            ))}
          </fieldset>
          {reason === "OTHER" && (
            <div className="flex flex-col gap-1">
              <FieldLabel htmlFor="portal-reject-note">Say why</FieldLabel>
              <Input
                id="portal-reject-note"
                value={note}
                maxLength={500}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
          )}
          {error && <FieldError>{error}</FieldError>}
          <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
            <DialogClose asChild>
              <Button variant="ghost" size="lg" disabled={busy}>
                Cancel
              </Button>
            </DialogClose>
            <Button
              type="submit"
              size="lg"
              variant="destructive"
              disabled={busy}
            >
              Reject candidate
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface Draft {
  startsAt: string;
  durationMinutes: number;
  mode: SlotMode;
  note: string;
}

const blank = (): Draft => ({
  startsAt: "",
  durationMinutes: 45,
  mode: "VIDEO",
  note: "",
});

function ProposeTimes({
  id,
  onDone,
}: {
  id: string;
  onDone: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Draft[]>([blank()]);
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [form, setForm] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const change = (i: number, patch: Partial<Draft>) => {
    setRows((list) => list.map((r, j) => (j === i ? { ...r, ...patch } : r)));
    setErrors((e) =>
      Object.fromEntries(Object.entries(e).filter(([k]) => Number(k) !== i)),
    );
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const found: Record<number, string> = {};
    rows.forEach((r, i) => {
      const problem = checkSlotTime(r.startsAt, r.durationMinutes, new Date());
      if (problem) found[i] = problem;
    });
    setErrors(found);
    setForm(null);
    if (Object.keys(found).length > 0) return;

    setBusy(true);
    const res = await api<{ ok: true }>(
      `/api/portal/applications/${id}/slots`,
      {
        json: {
          slots: rows.map((r) => ({
            startsAt: r.startsAt,
            durationMinutes: r.durationMinutes,
            mode: r.mode,
            note: r.note.trim() || undefined,
          })),
        },
      },
    );
    setBusy(false);
    if (res.ok) {
      setOpen(false);
      setRows([blank()]);
      onDone("Times sent. Your recruiter will confirm one.");
      return;
    }
    const fromServer: Record<number, string> = {};
    for (const [key, message] of Object.entries(res.fields)) {
      const m = /^slots\.(\d+)\./.exec(key);
      if (m) fromServer[Number(m[1])] = message;
    }
    setErrors(fromServer);
    if (Object.keys(fromServer).length === 0) setForm(res.error);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        size="lg"
        variant="outline"
        className="flex-1"
        onClick={() => setOpen(true)}
      >
        Propose times
      </Button>
      <DialogContent
        title="Propose interview times"
        description="Up to three times, in Indian Standard Time (IST), on weekdays between 9:00 and 19:00. Proposing a time also shortlists the candidate."
      >
        <form
          onSubmit={(e) => void submit(e)}
          className="flex flex-col gap-5"
          noValidate
        >
          {rows.map((r, i) => (
            <fieldset
              key={i}
              className="flex flex-col gap-3 border-t border-border pt-3"
            >
              <legend className="px-0 text-sm font-medium">Time {i + 1}</legend>
              <div className="flex flex-col gap-1">
                <FieldLabel htmlFor={`slot-time-${i}`}>
                  Date and time (IST)
                </FieldLabel>
                <Input
                  id={`slot-time-${i}`}
                  type="datetime-local"
                  step={900}
                  value={r.startsAt}
                  aria-invalid={Boolean(errors[i])}
                  aria-describedby={errors[i] ? `slot-error-${i}` : undefined}
                  onChange={(e) => change(i, { startsAt: e.target.value })}
                />
                {errors[i] && (
                  <FieldError id={`slot-error-${i}`}>{errors[i]}</FieldError>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <FieldLabel htmlFor={`slot-length-${i}`}>Length</FieldLabel>
                  <Select
                    id={`slot-length-${i}`}
                    value={r.durationMinutes}
                    onChange={(e) =>
                      change(i, { durationMinutes: Number(e.target.value) })
                    }
                  >
                    {SLOT_MINUTES.map((m) => (
                      <option key={m} value={m}>
                        {m} minutes
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="flex flex-col gap-1">
                  <FieldLabel htmlFor={`slot-mode-${i}`}>Format</FieldLabel>
                  <Select
                    id={`slot-mode-${i}`}
                    value={r.mode}
                    onChange={(e) =>
                      change(i, { mode: e.target.value as SlotMode })
                    }
                  >
                    {SLOT_MODES.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <FieldLabel htmlFor={`slot-note-${i}`}>
                  Note for the candidate (optional)
                </FieldLabel>
                <Input
                  id={`slot-note-${i}`}
                  value={r.note}
                  maxLength={200}
                  onChange={(e) => change(i, { note: e.target.value })}
                />
              </div>
              {rows.length > 1 && (
                <Button
                  variant="ghost"
                  className="self-start"
                  onClick={() =>
                    setRows((list) => list.filter((_, j) => j !== i))
                  }
                >
                  Remove time {i + 1}
                </Button>
              )}
            </fieldset>
          ))}
          {rows.length < 3 && (
            <Button
              variant="outline"
              className="self-start"
              onClick={() => setRows((list) => [...list, blank()])}
            >
              Add another time
            </Button>
          )}
          {form && <FieldError>{form}</FieldError>}
          <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
            <DialogClose asChild>
              <Button variant="ghost" size="lg" disabled={busy}>
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" size="lg" disabled={busy}>
              Send times
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
