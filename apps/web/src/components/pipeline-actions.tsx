"use client";

import { useState } from "react";
import {
  NOTE_LIMITS,
  clientRejectLabel,
  formatIst,
  slotModeLabel,
  type ClientRejection,
  type MessageView,
  type SlotView,
  type Stage,
} from "@hireproof/shared";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { FieldError, FieldLabel } from "@/components/ui/field";
import { api } from "@/lib/api";

export const clientDecisionText = (r: ClientRejection) =>
  `Rejected by client: ${clientRejectLabel(r.reason)}${r.note ? `, ${r.note}` : ""}`;

function SubmitToClient({
  applicationId,
  onChanged,
}: {
  applicationId: string;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const length = note.trim().length;
  const tooShort = length < NOTE_LIMITS.min;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (tooShort) {
      setError(
        `Write at least ${NOTE_LIMITS.min} characters on why this candidate.`,
      );
      return;
    }
    setBusy(true);
    setError(null);
    const res = await api<{ ok: true }>(
      `/api/applications/${applicationId}/submit`,
      { json: { note: note.trim() } },
    );
    setBusy(false);
    if (res.ok) {
      setOpen(false);
      setNote("");
      onChanged();
    } else {
      setError(res.error);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button onClick={() => setOpen(true)}>Submit to client</Button>
      <DialogContent
        title="Submit to client"
        description="The hiring manager sees this note first, then the evidence from the CV. They never see contact details."
      >
        <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <FieldLabel htmlFor={`note-${applicationId}`}>
              Why this candidate
            </FieldLabel>
            <textarea
              id={`note-${applicationId}`}
              value={note}
              rows={5}
              maxLength={NOTE_LIMITS.max}
              aria-invalid={Boolean(error)}
              aria-describedby={`note-count-${applicationId}`}
              onChange={(e) => {
                setNote(e.target.value);
                setError(null);
              }}
              className="min-h-28 w-full rounded-md border border-input bg-card px-3 py-2 text-base text-foreground placeholder:text-muted-foreground focus-visible:outline-offset-0 aria-invalid:border-destructive"
            />
            <p
              id={`note-count-${applicationId}`}
              className="text-sm text-muted-foreground"
            >
              <span className="num">{length}</span> of{" "}
              <span className="num">{NOTE_LIMITS.max}</span> characters, at
              least <span className="num">{NOTE_LIMITS.min}</span>
            </p>
          </div>
          {error && <FieldError>{error}</FieldError>}
          <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
            <DialogClose asChild>
              <Button variant="ghost" disabled={busy}>
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={busy}>
              Submit to client
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const MOVES: Partial<
  Record<Stage, { to: string; label: string; primary?: boolean }[]>
> = {
  INTERVIEW: [
    { to: "OFFERED", label: "Move to offered", primary: true },
    { to: "REJECTED", label: "Not selected" },
  ],
  OFFERED: [
    { to: "JOINED", label: "Mark joined", primary: true },
    { to: "WITHDRAWN", label: "Offer fell through" },
  ],
};

// The next step for a recruiter at each stage after screening.
export function PipelineActions({
  applicationId,
  stage,
  onChanged,
}: {
  applicationId: string;
  stage: Stage;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function send(path: string, json: object = {}) {
    setBusy(true);
    setProblem(null);
    const res = await api<{ ok: true }>(
      `/api/applications/${applicationId}/${path}`,
      { json },
    );
    setBusy(false);
    if (res.ok) onChanged();
    else setProblem(res.error);
  }

  const moves = MOVES[stage];
  if (stage !== "SCREENED" && stage !== "SUBMITTED" && !moves) return null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {stage === "SCREENED" && (
          <SubmitToClient applicationId={applicationId} onChanged={onChanged} />
        )}
        {stage === "SUBMITTED" && (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void send("withdraw")}
          >
            Withdraw submission
          </Button>
        )}
        {moves?.map((m) => (
          <Button
            key={m.to}
            variant={m.primary ? "default" : "outline"}
            disabled={busy}
            onClick={() => void send("move", { to: m.to })}
          >
            {m.label}
          </Button>
        ))}
      </div>
      {problem && (
        <p role="alert" className="text-sm text-destructive">
          {problem}
        </p>
      )}
    </div>
  );
}

const SLOT_STATUS = {
  PROPOSED: "Proposed",
  CONFIRMED: "Confirmed",
  DECLINED: "Declined",
} as const;

export const MOCK_NOTE =
  "Message to candidate recorded, not sent: messaging is mocked in this demo.";

// The client's proposed times, each in IST, with the recruiter's answer.
export function ProposedTimes({
  applicationId,
  slots,
  canEdit,
  onChanged,
}: {
  applicationId: string;
  slots: SlotView[];
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [recorded, setRecorded] = useState<string | null>(null);

  if (slots.length === 0) return null;
  const pending = slots.some((s) => s.status === "PROPOSED");

  async function answer(key: string, path: string, isCandidate: boolean) {
    setBusy(key);
    setProblem(null);
    const res = await api<{ message: MessageView }>(path, { json: {} });
    setBusy(null);
    if (res.ok) {
      setRecorded(
        isCandidate
          ? MOCK_NOTE
          : "Message to client recorded, not sent: messaging is mocked in this demo.",
      );
      onChanged();
    } else {
      setProblem(res.error);
    }
  }

  return (
    <section
      aria-label="Proposed times"
      className="flex flex-col gap-2 rounded-md bg-muted px-4 py-3"
    >
      <h3 className="text-sm font-medium">Proposed times</h3>
      <ul className="flex flex-col">
        {slots.map((s) => (
          <li
            key={s.id}
            className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-border py-2 last:border-0"
          >
            <span className="text-sm">
              {formatIst(s.startsAt)},{" "}
              <span className="num">{s.durationMinutes}</span> minutes,{" "}
              {slotModeLabel(s.mode).toLowerCase()}
              {s.note ? `. ${s.note}` : ""}
            </span>
            {s.status === "PROPOSED" && canEdit ? (
              <Button
                size="sm"
                disabled={busy !== null}
                onClick={() =>
                  void answer(s.id, `/api/slots/${s.id}/confirm`, true)
                }
              >
                Confirm
              </Button>
            ) : (
              <span
                className={`text-sm ${s.status === "CONFIRMED" ? "font-medium" : "text-muted-foreground"}`}
              >
                {SLOT_STATUS[s.status]}
              </span>
            )}
          </li>
        ))}
      </ul>
      {pending && canEdit && (
        <Button
          variant="outline"
          size="sm"
          className="self-start"
          disabled={busy !== null}
          onClick={() =>
            void answer(
              "none",
              `/api/applications/${applicationId}/slots/decline`,
              false,
            )
          }
        >
          None of these work
        </Button>
      )}
      {recorded && (
        <p role="status" className="text-sm">
          {recorded}
        </p>
      )}
      {problem && (
        <p role="alert" className="text-sm text-destructive">
          {problem}
        </p>
      )}
    </section>
  );
}

export function Outbox({ messages }: { messages: MessageView[] }) {
  if (messages.length === 0) return null;
  return (
    <section aria-label="Recorded messages" className="flex flex-col gap-1">
      {messages.map((m) => (
        <details key={m.id} className="rounded-md bg-muted px-4 py-2">
          <summary className="min-h-8 cursor-pointer text-sm font-medium">
            Message to {m.recipient === "CANDIDATE" ? "candidate" : "client"},
            recorded, not sent
          </summary>
          <p className="mt-2 text-sm font-medium">{m.subject}</p>
          <p className="mt-1 text-sm whitespace-pre-wrap">{m.body}</p>
        </details>
      ))}
    </section>
  );
}
