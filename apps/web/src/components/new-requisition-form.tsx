"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  LIMITS,
  type ClientSummary,
  type RequisitionDetail,
} from "@hireproof/shared";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { api } from "@/lib/api";

// Shown at least this long so a quick answer does not flash past.
const MIN_PROGRESS_MS = 700;
const FILE_TYPES = /\.(pdf|docx|txt)$/i;

type Mode = "paste" | "file";

export function NewRequisitionForm() {
  const router = useRouter();
  const [clients, setClients] = useState<ClientSummary[] | null>(null);
  const [clientsFailed, setClientsFailed] = useState(false);
  const [clientId, setClientId] = useState("");
  const [title, setTitle] = useState("");
  const [mode, setMode] = useState<Mode>("paste");
  const [jdText, setJdText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);

  useEffect(() => {
    void api<ClientSummary[]>("/api/clients").then((res) => {
      if (res.ok) setClients(res.data);
      else setClientsFailed(true);
    });
  }, []);

  function pickFile(next: File | null) {
    setFile(next);
    if (!next) return setErrors((e) => ({ ...e, jdFile: "" }));
    let problem = "";
    if (!FILE_TYPES.test(next.name)) {
      problem = "Upload a .pdf, .docx or .txt file.";
    } else if (next.size > LIMITS.jdFileBytes) {
      problem = "The file is larger than 2 MB.";
    } else if (next.size === 0) {
      problem = "This file is empty.";
    }
    setErrors((e) => ({ ...e, jdFile: problem }));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting.current) return;

    const found: Record<string, string> = {};
    if (!clientId) found.clientId = "Choose a client";
    if (mode === "paste" && jdText.trim().length < 20) {
      found.jdText = "Paste the job description.";
    }
    if (mode === "file") {
      if (!file) found.jdFile = "Choose a file to upload.";
      else if (errors.jdFile) found.jdFile = errors.jdFile;
    }
    setErrors(found);
    setFormError(null);
    if (Object.keys(found).length > 0) {
      document.getElementById(`field-${Object.keys(found)[0]}`)?.focus();
      return;
    }

    submitting.current = true;
    setPending(true);
    const form = new FormData();
    form.set("clientId", clientId);
    if (title.trim()) form.set("title", title.trim());
    if (mode === "paste") form.set("jdText", jdText);
    else if (file) form.set("jdFile", file);

    const started = Date.now();
    const res = await api<RequisitionDetail>("/api/requisitions", { form });
    const wait = MIN_PROGRESS_MS - (Date.now() - started);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));

    if (res.ok) {
      router.push(`/requisitions/${res.data.id}`);
      return;
    }
    setErrors(res.fields);
    setFormError(Object.keys(res.fields).length ? null : res.error);
    submitting.current = false;
    setPending(false);
  }

  return (
    <form
      noValidate
      onSubmit={submit}
      className="flex max-w-2xl flex-col gap-6"
    >
      <h1>New requisition</h1>

      <Field data-invalid={!!errors.clientId}>
        <FieldLabel htmlFor="field-clientId">Client</FieldLabel>
        <Select
          id="field-clientId"
          value={clientId}
          disabled={pending || !clients}
          onChange={(e) => setClientId(e.target.value)}
          aria-invalid={!!errors.clientId}
          aria-describedby={errors.clientId ? "clientId-error" : undefined}
        >
          <option value="">
            {clients ? "Choose a client" : "Loading clients"}
          </option>
          {clients?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <FieldError id="clientId-error">{errors.clientId}</FieldError>
        {clientsFailed && (
          <FieldError>
            Clients could not load. Reload the page to retry.
          </FieldError>
        )}
      </Field>

      <Field>
        <FieldLabel htmlFor="field-title">Title (optional)</FieldLabel>
        <Input
          id="field-title"
          value={title}
          maxLength={120}
          disabled={pending}
          onChange={(e) => setTitle(e.target.value)}
        />
        <FieldDescription>
          Left blank, the title is read from the job description.
        </FieldDescription>
      </Field>

      <fieldset className="flex flex-col gap-3" disabled={pending}>
        <legend className="mb-1.5 text-sm font-medium">Job description</legend>
        <div
          className="flex gap-2"
          role="group"
          aria-label="Job description source"
        >
          {(
            [
              ["paste", "Paste text"],
              ["file", "Upload a file"],
            ] as const
          ).map(([value, label]) => (
            <Button
              key={value}
              variant="outline"
              aria-pressed={mode === value}
              className={mode === value ? "bg-primary-soft" : undefined}
              onClick={() => setMode(value)}
            >
              {label}
            </Button>
          ))}
        </div>

        {mode === "paste" ? (
          <Field data-invalid={!!errors.jdText}>
            <textarea
              id="field-jdText"
              aria-label="Job description text"
              rows={12}
              value={jdText}
              onChange={(e) => setJdText(e.target.value)}
              aria-invalid={!!errors.jdText}
              aria-describedby={errors.jdText ? "jdText-error" : undefined}
              className="w-full rounded-md border border-input bg-card px-3 py-2 text-base text-foreground aria-invalid:border-destructive"
            />
            <FieldError id="jdText-error">{errors.jdText}</FieldError>
          </Field>
        ) : (
          <Field data-invalid={!!errors.jdFile}>
            <Input
              id="field-jdFile"
              type="file"
              aria-label="Job description file"
              accept=".pdf,.docx,.txt"
              onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
              aria-invalid={!!errors.jdFile}
              aria-describedby={errors.jdFile ? "jdFile-error" : "jdFile-hint"}
              className="h-auto py-2"
            />
            <FieldDescription id="jdFile-hint">
              PDF, Word (.docx) or plain text, up to 2 MB.
            </FieldDescription>
            <FieldError id="jdFile-error">{errors.jdFile}</FieldError>
          </Field>
        )}
      </fieldset>

      {formError && (
        <p role="alert" className="text-sm text-destructive">
          {formError}
        </p>
      )}

      <div className="flex items-center gap-4">
        <Button type="submit" disabled={pending}>
          {pending ? "Reading the job description" : "Create requisition"}
        </Button>
        <p role="status" className="text-sm text-muted-foreground">
          {pending ? "This takes a few seconds." : ""}
        </p>
      </div>
    </form>
  );
}
