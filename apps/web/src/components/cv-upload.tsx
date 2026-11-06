"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CV_LIMITS,
  type CvStatus,
  type FileResult,
  type UploadBatchView,
} from "@hireproof/shared";
import { CvStatusLabel } from "@/components/cv-status";
import { formatDate } from "@/components/status";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";

const POLL_MS = 2000;
const MAX_MB = CV_LIMITS.fileBytes / (1024 * 1024);

// One row per file the person picked, whatever stage it has reached.
interface Row {
  key: string;
  fileName: string;
  // Local states come before the server knows the file.
  stage: "REJECTED" | "UPLOADING" | CvStatus;
  note: string | null;
  cvId: string | null;
}

function checkFile(file: File): string | null {
  if (!/\.(pdf|docx)$/i.test(file.name)) {
    return "Only PDF and DOCX files are accepted.";
  }
  if (file.size === 0) return "This file is empty.";
  if (file.size > CV_LIMITS.fileBytes) {
    return `This file is larger than ${MAX_MB} MB.`;
  }
  return null;
}

function summary(rows: Row[]) {
  const n = (test: (r: Row) => boolean) => rows.filter(test).length;
  const parts = [
    [n((r) => r.stage === "PARSED"), "parsed"],
    [n((r) => r.stage === "NEEDS_REVIEW"), "need review"],
    [n((r) => r.stage === "FAILED"), "failed"],
    [n((r) => r.stage === "DUPLICATE_FILE"), "duplicate files"],
    [n((r) => r.stage === "REJECTED"), "not accepted"],
  ] as const;
  return parts
    .filter(([count]) => count > 0)
    .map(([count, label]) =>
      count === 1 && label === "duplicate files"
        ? "1 duplicate file"
        : `${count} ${label}`,
    )
    .join(", ");
}

const isFinal = (stage: Row["stage"]) =>
  stage === "REJECTED" ||
  stage === "PARSED" ||
  stage === "NEEDS_REVIEW" ||
  stage === "FAILED" ||
  stage === "DUPLICATE_FILE";

export function CvUpload({
  requisitionId,
  canUpload,
  onProgress,
}: {
  requisitionId: string;
  canUpload: boolean;
  // Called when more files have finished, so the list below can refresh.
  onProgress: (finished: number) => void;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [sent, setSent] = useState<{ done: number; total: number } | null>(
    null,
  );
  const [batchId, setBatchId] = useState<string | null>(null);
  const [pollKey, setPollKey] = useState(0);
  const [startedAt, setStartedAt] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  // File names announced by this browser session, in order, so server rows
  // (which come back by name) can be matched to them.
  const announced = useRef<string[]>([]);
  const uploading = sent !== null && sent.done < sent.total;

  const applyServer = useCallback((view: UploadBatchView) => {
    setRows((current) => {
      const local = current.filter((r) => r.stage === "REJECTED");
      const queues = new Map<string, UploadBatchView["files"]>();
      for (const f of view.files) {
        queues.set(f.fileName, [...(queues.get(f.fileName) ?? []), f]);
      }
      const merged: Row[] = [];
      const names = announced.current.length
        ? announced.current
        : view.files.map((f) => f.fileName);
      for (const name of names) {
        const file = queues.get(name)?.shift();
        merged.push(
          file
            ? {
                key: file.id,
                fileName: name,
                stage: file.status,
                note: file.failureReason ?? file.reviewReasons.join(" "),
                cvId: file.id,
              }
            : {
                key: `wait-${name}-${merged.length}`,
                fileName: name,
                stage: "UPLOADING",
                note: null,
                cvId: null,
              },
        );
      }
      return [...local, ...merged];
    });
  }, []);

  // Poll until every file the batch holds has settled.
  useEffect(() => {
    if (!batchId || uploading) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      const res = await api<UploadBatchView>(`/api/uploads/${batchId}`);
      if (stop) return;
      if (res.ok) {
        applyServer(res.data);
        onProgress(res.data.files.filter((f) => isFinal(f.status)).length);
        if (res.data.done) return;
      }
      timer = setTimeout(() => void poll(), POLL_MS);
    }
    void poll();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [batchId, pollKey, uploading, applyServer, onProgress]);

  // Coming back to the page shows the last upload.
  useEffect(() => {
    let current = true;
    void api<UploadBatchView | null>(
      `/api/requisitions/${requisitionId}/uploads/latest`,
    ).then((res) => {
      if (!current || !res.ok || !res.data) return;
      announced.current = [];
      applyServer(res.data);
      setStartedAt(res.data.createdAt);
      setBatchId(res.data.id);
    });
    return () => {
      current = false;
    };
  }, [requisitionId, applyServer, onProgress]);

  async function start(picked: File[]) {
    setProblem(null);
    const rejected: Row[] = [];
    const accepted: File[] = [];
    for (const file of picked) {
      const reason =
        checkFile(file) ??
        (accepted.length >= CV_LIMITS.batchFiles
          ? `An upload holds at most ${CV_LIMITS.batchFiles} files.`
          : null);
      if (reason) {
        rejected.push({
          key: `no-${file.name}-${rejected.length}`,
          fileName: file.name,
          stage: "REJECTED",
          note: reason,
          cvId: null,
        });
      } else {
        accepted.push(file);
      }
    }
    announced.current = accepted.map((f) => f.name);
    setStartedAt(new Date().toISOString());
    setBatchId(null);
    setRows([
      ...rejected,
      ...accepted.map((f, i) => ({
        key: `up-${i}`,
        fileName: f.name,
        stage: "UPLOADING" as const,
        note: null,
        cvId: null,
      })),
    ]);
    if (accepted.length === 0) return;

    const created = await api<{ batchId: string }>(
      `/api/requisitions/${requisitionId}/uploads`,
      { json: { expectedCount: accepted.length } },
    );
    if (!created.ok) {
      setProblem(created.error);
      setRows(rejected);
      return;
    }
    setSent({ done: 0, total: accepted.length });
    for (let i = 0; i < accepted.length; i += CV_LIMITS.requestFiles) {
      const chunk = accepted.slice(i, i + CV_LIMITS.requestFiles);
      const form = new FormData();
      for (const file of chunk) form.append("files", file);
      const res = await api<{ results: FileResult[] }>(
        `/api/uploads/${created.data.batchId}/files`,
        { form },
      );
      if (res.ok) {
        const refused = res.data.results.filter((r) => !r.accepted);
        if (refused.length > 0) {
          // The server refused these, so they are not part of the batch.
          const gone = new Set(refused.map((r) => r.fileName));
          announced.current = announced.current.filter((n) => !gone.has(n));
          setRows((r) => [
            ...r.filter(
              (x) => !(gone.has(x.fileName) && x.stage === "UPLOADING"),
            ),
            ...refused.map((f, k) => ({
              key: `refused-${i}-${k}`,
              fileName: f.fileName,
              stage: "REJECTED" as const,
              note: f.reason,
              cvId: null,
            })),
          ]);
        }
      } else {
        const names = new Set(chunk.map((f) => f.name));
        announced.current = announced.current.filter((n) => !names.has(n));
        setRows((r) => [
          ...r.filter(
            (x) => !(names.has(x.fileName) && x.stage === "UPLOADING"),
          ),
          ...chunk.map((f, k) => ({
            key: `lost-${i}-${k}`,
            fileName: f.name,
            stage: "REJECTED" as const,
            note: res.error,
            cvId: null,
          })),
        ]);
      }
      setSent({
        done: Math.min(i + chunk.length, accepted.length),
        total: accepted.length,
      });
    }
    setBatchId(created.data.batchId);
  }

  async function retry(cvId: string) {
    const res = await api<{ ok: true }>(`/api/cvs/${cvId}/retry`, {
      method: "POST",
      json: {},
    });
    if (!res.ok) {
      setProblem(res.error);
      return;
    }
    setRows((r) =>
      r.map((x) =>
        x.cvId === cvId ? { ...x, stage: "QUEUED", note: null } : x,
      ),
    );
    // Polling stops once a batch settles; start it again.
    setPollKey((k) => k + 1);
  }

  const finished = rows.filter((r) => isFinal(r.stage)).length;
  const working = rows.length > 0 && finished < rows.length;

  return (
    <section aria-labelledby="upload-heading" className="flex flex-col gap-4">
      <h2 id="upload-heading">Upload CVs</h2>

      {canUpload ? (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            if (!uploading) void start([...e.dataTransfer.files]);
          }}
          className={`flex flex-col items-start gap-3 rounded-lg border border-dashed px-5 py-6 transition-colors duration-(--dur-micro) ${
            dragging ? "border-ring bg-primary-soft" : "border-input bg-card"
          }`}
        >
          <p>
            Drop PDF or DOCX files here, or choose them. Up to{" "}
            {CV_LIMITS.batchFiles} files, {MAX_MB} MB each.
          </p>
          <input
            ref={input}
            type="file"
            multiple
            accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            className="visually-hidden"
            aria-label="Choose CV files"
            onChange={(e) => {
              const picked = [...(e.target.files ?? [])];
              e.target.value = "";
              if (picked.length > 0) void start(picked);
            }}
          />
          <Button
            variant="outline"
            disabled={uploading}
            onClick={() => input.current?.click()}
          >
            Choose files
          </Button>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Only recruiters can upload CVs. You can follow the latest upload here.
        </p>
      )}

      {problem && (
        <p
          role="alert"
          className="rounded-md bg-destructive-soft px-4 py-3 text-sm text-destructive"
        >
          {problem}
        </p>
      )}

      {sent && sent.done < sent.total && (
        <div className="flex flex-col gap-1">
          <label htmlFor="sent" className="text-sm">
            Sending files, {sent.done} of {sent.total}
          </label>
          <progress
            id="sent"
            value={sent.done}
            max={sent.total}
            className="h-2 w-full accent-(--color-primary)"
          />
        </div>
      )}

      {rows.length > 0 && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <p role="status" aria-live="polite" className="text-sm font-medium">
              {working
                ? `${finished} of ${rows.length} finished${summary(rows) ? `: ${summary(rows)}` : ""}`
                : summary(rows) || "Nothing to show."}
            </p>
            {startedAt && (
              <p className="text-sm text-muted-foreground">
                Latest upload, {formatDate(startedAt)}
              </p>
            )}
          </div>
          <details
            open={
              working ||
              rows.some(
                (r) => r.stage !== "PARSED" && r.stage !== "DUPLICATE_FILE",
              )
            }
            className="rounded-md border border-border bg-card"
          >
            <summary className="cursor-pointer px-4 py-2 text-sm font-medium">
              Files in this upload
            </summary>
            <ul className="max-h-96 overflow-y-auto border-t border-border px-4">
              {rows.map((row) => (
                <li
                  key={row.key}
                  className="flex flex-col gap-1 border-b border-border py-2 sm:flex-row sm:items-start sm:gap-4"
                >
                  <span className="min-w-0 break-words text-sm font-medium sm:w-1/3">
                    {row.fileName}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
                    {row.stage === "UPLOADING" ? (
                      <span className="inline-block rounded-sm bg-muted px-2 py-0.5 text-xs font-medium">
                        Uploading
                      </span>
                    ) : row.stage === "REJECTED" ? (
                      <span className="inline-block rounded-sm bg-destructive-soft px-2 py-0.5 text-xs font-medium text-destructive">
                        Not accepted
                      </span>
                    ) : (
                      <CvStatusLabel status={row.stage} />
                    )}
                    {row.note && (
                      <span className="text-sm text-muted-foreground">
                        {row.note}
                      </span>
                    )}
                    {canUpload &&
                      row.cvId &&
                      (row.stage === "FAILED" ||
                        row.stage === "NEEDS_REVIEW") && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void retry(row.cvId!)}
                          aria-label={`Run ${row.fileName} again`}
                        >
                          Run again
                        </Button>
                      )}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        </div>
      )}
    </section>
  );
}
