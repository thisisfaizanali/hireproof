"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { DELETION_REASONS, type DeletionReason } from "@hireproof/shared";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { api } from "@/lib/api";

const REMOVED = [
  "Every CV and its file",
  "The parsed profile",
  "Scores and their evidence",
  "Applications and where they stood",
  "Interview times and recorded messages",
  "Consent records and duplicate links",
];

export function DeleteCandidate({ id, code }: { id: string; code: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<DeletionReason | "">("");
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const ready = reason !== "" && typed.trim().toUpperCase() === code;

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setProblem(null);
    const res = await api<{ code: string }>(`/api/candidates/${id}`, {
      method: "DELETE",
      json: { reason, confirmCode: typed.trim() },
    });
    if (!res.ok) {
      setBusy(false);
      setProblem(res.error);
      return;
    }
    router.push("/data");
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setReason("");
          setTyped("");
          setProblem(null);
        }
      }}
    >
      <Button
        variant="ghost"
        className="text-destructive hover:bg-destructive-soft"
        onClick={() => setOpen(true)}
      >
        Delete candidate data
      </Button>
      <DialogContent
        title="Delete candidate data"
        description="This removes everything held about this person and cannot be undone."
      >
        <form onSubmit={(e) => void confirm(e)} className="flex flex-col gap-4">
          <div>
            <p className="text-sm font-medium">What will be removed</p>
            <ul className="mt-1 flex list-disc flex-col gap-0.5 pl-5 text-sm">
              {REMOVED.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <p className="mt-2 text-sm text-muted-foreground">
              A client who was sent this candidate will no longer see them. The
              audit log keeps the code, the reason and how much was removed, and
              no name, email or phone number.
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <FieldLabel htmlFor="delete-reason">Reason</FieldLabel>
            <Select
              id="delete-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value as DeletionReason | "")}
            >
              <option value="">Choose a reason</option>
              {DELETION_REASONS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <FieldLabel htmlFor="delete-code">
              Type <span className="num">{code}</span> to confirm
            </FieldLabel>
            <Input
              id="delete-code"
              autoComplete="off"
              spellCheck={false}
              value={typed}
              aria-invalid={problem !== null}
              onChange={(e) => setTyped(e.target.value)}
              className="num"
            />
            <FieldError>{problem}</FieldError>
          </div>
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="ghost" disabled={busy}>
                Cancel
              </Button>
            </DialogClose>
            <Button
              type="submit"
              variant="destructive"
              disabled={!ready || busy}
            >
              Delete all data
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
