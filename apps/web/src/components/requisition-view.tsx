"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  findQuote,
  formatReqNumber,
  type CriterionKind,
  type RequisitionDetail,
  type RequisitionStatus,
} from "@hireproof/shared";
import { EmptyState } from "@/components/empty-state";
import {
  NeedsReview,
  RequisitionStatusLabel,
  STATUS_LABEL,
  ScorecardStatusLabel,
} from "@/components/status";
import { Button } from "@/components/ui/button";
import { FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { api } from "@/lib/api";

interface Item {
  id?: string;
  kind: CriterionKind;
  label: string;
}

interface Form {
  criteria: Item[];
  minYears: string;
  maxYears: string;
  maxDays: string;
  maxLpa: string;
  locations: string[];
  reviewed: string[];
}

const text = (n: number | null) => (n === null ? "" : String(n));
const num = (s: string) => (s.trim() === "" ? null : Number(s));

function toForm(d: RequisitionDetail): Form {
  const s = d.scorecard!;
  return {
    criteria: s.criteria.map(({ id, kind, label }) => ({ id, kind, label })),
    minYears: text(s.experience.minYears),
    maxYears: text(s.experience.maxYears),
    maxDays: text(s.notice.maxDays),
    maxLpa: text(s.ctc.maxLpa),
    locations: [...s.locations.values],
    reviewed: [],
  };
}

function validate(form: Form, confirm: boolean) {
  const found: Record<string, string> = {};
  if (confirm && !form.criteria.some((c) => c.kind === "MUST_HAVE")) {
    found.criteria = "Add at least one must-have before confirming.";
  }
  if (form.criteria.some((c) => !c.label.trim())) {
    found.criteria = "Every requirement needs a name.";
  }
  const min = num(form.minYears);
  const max = num(form.maxYears);
  if (min !== null && max !== null && min > max) {
    found["experience.maxYears"] =
      "Maximum experience must be at least the minimum.";
  }
  for (const [key, value, top] of [
    ["experience.minYears", min, 40],
    ["experience.maxYears", max, 40],
    ["notice.maxDays", num(form.maxDays), 180],
    ["ctc.maxLpa", num(form.maxLpa), 200],
  ] as const) {
    if (value !== null && (Number.isNaN(value) || value < 0 || value > top)) {
      found[key] ??= `Enter a number from 0 to ${top}.`;
    }
  }
  return found;
}

type Load =
  | { state: "loading" }
  | { state: "error"; message: string; notFound: boolean }
  | { state: "ready" };

export function RequisitionView({
  id,
  canEdit,
}: {
  id: string;
  canEdit: boolean;
}) {
  const [detail, setDetail] = useState<RequisitionDetail | null>(null);
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [form, setForm] = useState<Form | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<{
    tone: "ok" | "error";
    text: string;
  } | null>(null);
  const [busy, setBusy] = useState<
    null | "save" | "confirm" | "extract" | "status"
  >(null);
  const [quote, setQuote] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    void api<RequisitionDetail>(`/api/requisitions/${id}`).then((res) => {
      if (!current) return;
      if (res.ok) {
        setDetail(res.data);
        setForm(toForm(res.data));
        setLoad({ state: "ready" });
      } else {
        setLoad({
          state: "error",
          message: res.error,
          notFound: res.status === 404,
        });
      }
    });
    return () => {
      current = false;
    };
  }, [id, attempt]);

  const dirty = useMemo(
    () =>
      !!detail &&
      !!form &&
      JSON.stringify(form) !== JSON.stringify(toForm(detail)),
    [detail, form],
  );

  if (load.state === "loading") {
    return (
      <div
        role="status"
        aria-label="Loading requisition"
        className="flex flex-col gap-4"
      >
        <div className="h-7 w-1/3 rounded-sm bg-muted" />
        <div className="h-40 rounded-lg bg-muted" />
      </div>
    );
  }
  if (load.state === "error") {
    return load.notFound ? (
      <EmptyState title="Requisition not found.">
        It may have been removed, or the link is wrong.
      </EmptyState>
    ) : (
      <section
        role="alert"
        className="rounded-lg border border-border bg-card px-5 py-6"
      >
        <h2>The requisition could not load</h2>
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
    );
  }
  if (!detail || !form || !detail.scorecard) return null;

  const card = detail.scorecard;
  const original = new Map(card.criteria.map((c) => [c.id, c]));
  const update = (patch: Partial<Form>) => setForm({ ...form, ...patch });

  function apply(next: RequisitionDetail, message: string) {
    setDetail(next);
    setForm(toForm(next));
    setErrors({});
    setNotice({ tone: "ok", text: message });
  }

  async function save(confirm: boolean) {
    if (!form) return;
    const found = validate(form, confirm);
    setErrors(found);
    setNotice(null);
    if (Object.keys(found).length > 0) {
      setNotice({ tone: "error", text: "Fix the highlighted fields first." });
      return;
    }
    setBusy(confirm ? "confirm" : "save");
    const res = await api<RequisitionDetail>(
      `/api/requisitions/${id}/scorecard`,
      {
        method: "PUT",
        json: {
          criteria: form.criteria.map((c) => ({
            ...c,
            reviewed: !!c.id && form.reviewed.includes(c.id),
          })),
          reviewed: {
            experience: form.reviewed.includes("experience"),
            notice: form.reviewed.includes("notice"),
            ctc: form.reviewed.includes("ctc"),
            locations: form.reviewed.includes("locations"),
          },
          experience: {
            minYears: num(form.minYears),
            maxYears: num(form.maxYears),
          },
          notice: { maxDays: num(form.maxDays) },
          ctc: { maxLpa: num(form.maxLpa) },
          locations: form.locations,
          confirm,
        },
      },
    );
    setBusy(null);
    if (res.ok) {
      apply(
        res.data,
        confirm
          ? "Scorecard confirmed. The requisition is open."
          : "Draft saved.",
      );
    } else {
      setErrors(res.fields);
      setNotice({ tone: "error", text: res.error });
    }
  }

  async function extractAgain() {
    if (
      dirty &&
      !window.confirm("Unsaved changes will be replaced. Continue?")
    ) {
      return;
    }
    const confirmed = card.status === "CONFIRMED";
    if (
      confirmed &&
      !window.confirm(
        "The confirmed scorecard will be replaced by a new draft. Continue?",
      )
    ) {
      return;
    }
    setBusy("extract");
    setNotice(null);
    const res = await api<RequisitionDetail>(
      `/api/requisitions/${id}/scorecard/extract`,
      { json: confirmed ? { force: true } : {} },
    );
    setBusy(null);
    if (res.ok) apply(res.data, "Extracted again. Check each field.");
    else setNotice({ tone: "error", text: res.error });
  }

  async function changeStatus(status: RequisitionStatus) {
    setBusy("status");
    setNotice(null);
    const res = await api<RequisitionDetail>(`/api/requisitions/${id}`, {
      method: "PATCH",
      json: { status },
    });
    setBusy(null);
    if (res.ok) setDetail({ ...detail!, status: res.data.status });
    else setNotice({ tone: "error", text: res.error });
  }

  const moveItem = (index: number, kind: CriterionKind) =>
    update({
      criteria: form.criteria.map((c, i) => (i === index ? { ...c, kind } : c)),
    });

  // A field a person changed no longer needs review.
  const itemReview = (item: Item) => {
    const was = item.id ? original.get(item.id) : undefined;
    return (
      !!was &&
      was.needsReview &&
      was.label === item.label &&
      was.kind === item.kind &&
      !form.reviewed.includes(item.id!)
    );
  };
  const sameNumber = (value: string, saved: number | null) =>
    num(value) === saved;
  const markReviewed = (key: string) =>
    update({ reviewed: [...form.reviewed, key] });
  const open = (key: string, flagged: boolean) =>
    flagged && !form.reviewed.includes(key);
  const flags = {
    experience: open(
      "experience",
      card.experience.needsReview &&
        sameNumber(form.minYears, card.experience.minYears) &&
        sameNumber(form.maxYears, card.experience.maxYears) &&
        (form.minYears !== "" || form.maxYears !== ""),
    ),
    notice: open(
      "notice",
      card.notice.needsReview &&
        form.maxDays !== "" &&
        sameNumber(form.maxDays, card.notice.maxDays),
    ),
    ctc: open(
      "ctc",
      card.ctc.needsReview &&
        form.maxLpa !== "" &&
        sameNumber(form.maxLpa, card.ctc.maxLpa),
    ),
    locations: open(
      "locations",
      card.locations.needsReview &&
        form.locations.length > 0 &&
        form.locations.join("|") === card.locations.values.join("|"),
    ),
  };
  const pending =
    form.criteria.filter(itemReview).length +
    Object.values(flags).filter(Boolean).length;

  const readOnly = !canEdit || busy !== null;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3 border-b border-border pb-4">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="num text-sm text-muted-foreground">
            {formatReqNumber(detail.number)}
          </span>
          <h1>{detail.title}</h1>
        </div>
        <div className="flex flex-wrap items-end gap-x-6 gap-y-3 text-sm">
          <p className="text-muted-foreground">
            {detail.client.name}, owned by {detail.owner.name}
          </p>
          {canEdit && detail.status !== "DRAFT" ? (
            <div className="flex items-center gap-2">
              <FieldLabel htmlFor="status">Status</FieldLabel>
              <Select
                id="status"
                className="w-36"
                value={detail.status}
                disabled={busy !== null}
                onChange={(e) =>
                  void changeStatus(e.target.value as RequisitionStatus)
                }
              >
                {(["OPEN", "ON_HOLD", "CLOSED"] as const).map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </option>
                ))}
              </Select>
            </div>
          ) : (
            <RequisitionStatusLabel status={detail.status} />
          )}
          <ScorecardStatusLabel status={card.status} />
        </div>
      </header>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
        <div className="flex min-w-0 flex-col gap-8">
          {card.status === "DRAFT" && card.source === "AI" && (
            <p className="rounded-md bg-review-soft px-4 py-3 text-sm text-review">
              Extracted by {card.model}. Check each field before confirming.
            </p>
          )}
          {card.status === "DRAFT" && card.source === "RULES" && (
            <div className="flex flex-col items-start gap-3 rounded-md bg-warning-soft px-4 py-3 text-sm text-warning">
              <p>
                The AI could not read this job description. Fields were filled
                by basic pattern matching; check each one.
              </p>
              {canEdit && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy !== null}
                  onClick={() => void extractAgain()}
                >
                  {busy === "extract"
                    ? "Reading the job description"
                    : "Try AI again"}
                </Button>
              )}
            </div>
          )}

          {card.ambiguities.length > 0 && (
            <section aria-labelledby="ambiguities">
              <h2 id="ambiguities">Unclear in the job description</h2>
              <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-sm">
                {card.ambiguities.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </section>
          )}

          {errors.criteria && <FieldError>{errors.criteria}</FieldError>}

          {(["MUST_HAVE", "NICE_TO_HAVE"] as const).map((kind) => (
            <CriteriaList
              key={kind}
              kind={kind}
              items={form.criteria}
              readOnly={readOnly}
              reviewOf={itemReview}
              onReviewed={(item) => markReviewed(item.id!)}
              quoteOf={(item) =>
                item.id ? (original.get(item.id)?.sourceQuote ?? null) : null
              }
              onFocusQuote={setQuote}
              onChange={(index, label) =>
                update({
                  criteria: form.criteria.map((c, i) =>
                    i === index ? { ...c, label } : c,
                  ),
                })
              }
              onMove={moveItem}
              onRemove={(index) =>
                update({
                  criteria: form.criteria.filter((_, i) => i !== index),
                })
              }
              onAdd={(label) =>
                update({ criteria: [...form.criteria, { kind, label }] })
              }
            />
          ))}

          <section
            aria-labelledby="constraints"
            className="flex flex-col gap-4"
          >
            <h2 id="constraints">Constraints</h2>
            <p className="text-sm text-muted-foreground">
              Shown as flags beside each score. They never hide or reject
              anyone.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Constraint
                label="Experience, minimum (years)"
                id="experience.minYears"
                value={form.minYears}
                error={errors["experience.minYears"]}
                readOnly={readOnly}
                review={flags.experience}
                onReviewed={() => markReviewed("experience")}
                quote={card.experience.sourceQuote}
                onFocusQuote={setQuote}
                onChange={(v) => update({ minYears: v })}
              />
              <Constraint
                label="Experience, maximum (years)"
                id="experience.maxYears"
                value={form.maxYears}
                error={errors["experience.maxYears"]}
                readOnly={readOnly}
                review={flags.experience}
                onReviewed={() => markReviewed("experience")}
                quote={card.experience.sourceQuote}
                onFocusQuote={setQuote}
                onChange={(v) => update({ maxYears: v })}
              />
              <Constraint
                label="Notice period, up to (days)"
                id="notice.maxDays"
                value={form.maxDays}
                error={errors["notice.maxDays"]}
                readOnly={readOnly}
                review={flags.notice}
                onReviewed={() => markReviewed("notice")}
                quote={card.notice.sourceQuote}
                onFocusQuote={setQuote}
                onChange={(v) => update({ maxDays: v })}
              />
              <Constraint
                label="CTC budget, up to (LPA)"
                id="ctc.maxLpa"
                value={form.maxLpa}
                error={errors["ctc.maxLpa"]}
                readOnly={readOnly}
                review={flags.ctc}
                onReviewed={() => markReviewed("ctc")}
                quote={card.ctc.sourceQuote}
                onFocusQuote={setQuote}
                onChange={(v) => update({ maxLpa: v })}
              />
            </div>
            <Locations
              values={form.locations}
              readOnly={readOnly}
              review={flags.locations}
              onReviewed={() => markReviewed("locations")}
              quote={card.locations.sourceQuote}
              onFocusQuote={setQuote}
              onChange={(locations) => update({ locations })}
            />
          </section>

          {canEdit && (
            <div className="flex flex-col gap-3 border-t border-border pt-4">
              <div className="flex flex-wrap gap-3">
                <Button
                  variant="outline"
                  disabled={busy !== null || !dirty}
                  onClick={() => void save(false)}
                >
                  {busy === "save" ? "Saving" : "Save draft"}
                </Button>
                <Button
                  disabled={busy !== null || pending > 0}
                  aria-describedby="pending-hint"
                  onClick={() => void save(true)}
                >
                  {busy === "confirm" ? "Confirming" : "Confirm scorecard"}
                </Button>
                {card.source !== "RULES" && (
                  <Button
                    variant="ghost"
                    disabled={busy !== null}
                    onClick={() => void extractAgain()}
                  >
                    Extract again
                  </Button>
                )}
              </div>
              <p id="pending-hint" className="text-sm text-review">
                {pending > 0
                  ? `${pending} ${pending === 1 ? "item still needs" : "items still need"} review`
                  : ""}
              </p>
              <p
                role={notice?.tone === "error" ? "alert" : "status"}
                className={`text-sm ${notice?.tone === "error" ? "text-destructive" : "text-success"}`}
              >
                {notice?.text}
              </p>
            </div>
          )}
        </div>

        <aside className="min-w-0">
          <div className="hidden lg:sticky lg:top-6 lg:block">
            <JdPane
              jd={detail.jdText}
              quote={quote}
              fileName={detail.jdFileName}
            />
          </div>
          <details className="rounded-lg border border-border bg-card lg:hidden">
            <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
              Job description
            </summary>
            <div className="border-t border-border">
              <JdPane
                jd={detail.jdText}
                quote={quote}
                fileName={detail.jdFileName}
              />
            </div>
          </details>
        </aside>
      </div>
    </div>
  );
}

function QuoteLine({
  quote,
  review,
  onReviewed,
}: {
  quote: string | null;
  review: boolean;
  onReviewed?: () => void;
}) {
  return (
    <div className="flex flex-col gap-1 text-sm">
      {review && (
        <span className="flex flex-wrap items-center gap-2">
          <NeedsReview />
          {onReviewed && (
            <Button variant="outline" size="sm" onClick={onReviewed}>
              Looks right
            </Button>
          )}
        </span>
      )}
      {quote ? (
        <details>
          <summary className="cursor-pointer text-muted-foreground">
            From the job description
          </summary>
          <blockquote className="mt-1 border-l-2 border-border pl-3 text-muted-foreground">
            {quote}
          </blockquote>
        </details>
      ) : review ? (
        <span className="text-muted-foreground">
          No matching text found in the job description.
        </span>
      ) : null}
    </div>
  );
}

function CriteriaList({
  kind,
  items,
  readOnly,
  reviewOf,
  onReviewed,
  quoteOf,
  onFocusQuote,
  onChange,
  onMove,
  onRemove,
  onAdd,
}: {
  kind: CriterionKind;
  items: Item[];
  readOnly: boolean;
  reviewOf: (item: Item) => boolean;
  onReviewed: (item: Item) => void;
  quoteOf: (item: Item) => string | null;
  onFocusQuote: (quote: string | null) => void;
  onChange: (index: number, label: string) => void;
  onMove: (index: number, kind: CriterionKind) => void;
  onRemove: (index: number) => void;
  onAdd: (label: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const title = kind === "MUST_HAVE" ? "Must-have" : "Nice-to-have";
  const other: CriterionKind =
    kind === "MUST_HAVE" ? "NICE_TO_HAVE" : "MUST_HAVE";
  const shown = items
    .map((item, index) => ({ item, index }))
    .filter((x) => x.item.kind === kind);

  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <h2>{title}</h2>
      {shown.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {kind === "MUST_HAVE"
            ? "No must-haves yet. A scorecard needs at least one."
            : "No nice-to-haves."}
        </p>
      )}
      <ul className="flex flex-col">
        {shown.map(({ item, index }) => (
          <li
            key={item.id ?? `new-${index}`}
            className="flex flex-col gap-2 border-b border-border py-3"
            onMouseEnter={() => onFocusQuote(quoteOf(item))}
            onFocus={() => onFocusQuote(quoteOf(item))}
          >
            <div className="flex flex-wrap items-center gap-2">
              <Input
                aria-label={`${title} requirement`}
                value={item.label}
                readOnly={readOnly}
                maxLength={200}
                onChange={(e) => onChange(index, e.target.value)}
                className="min-w-0 flex-1 basis-48"
              />
              {!readOnly && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onMove(index, other)}
                  >
                    Move to{" "}
                    {other === "MUST_HAVE" ? "must-have" : "nice-to-have"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Remove ${item.label}`}
                    onClick={() => onRemove(index)}
                  >
                    Remove
                  </Button>
                </>
              )}
            </div>
            <QuoteLine
              quote={quoteOf(item)}
              review={reviewOf(item)}
              onReviewed={readOnly ? undefined : () => onReviewed(item)}
            />
          </li>
        ))}
      </ul>
      {!readOnly && (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (draft.trim()) {
              onAdd(draft.trim());
              setDraft("");
            }
          }}
        >
          <Input
            aria-label={`Add a ${title.toLowerCase()} requirement`}
            placeholder="Add a requirement"
            value={draft}
            maxLength={200}
            onChange={(e) => setDraft(e.target.value)}
          />
          <Button type="submit" variant="outline">
            Add
          </Button>
        </form>
      )}
    </section>
  );
}

function Constraint({
  label,
  id,
  value,
  error,
  readOnly,
  review,
  onReviewed,
  quote,
  onFocusQuote,
  onChange,
}: {
  label: string;
  id: string;
  value: string;
  error?: string;
  readOnly: boolean;
  review: boolean;
  onReviewed: () => void;
  quote: string | null;
  onFocusQuote: (quote: string | null) => void;
  onChange: (value: string) => void;
}) {
  return (
    <div
      className="flex flex-col gap-1.5"
      onMouseEnter={() => onFocusQuote(quote)}
      onFocus={() => onFocusQuote(quote)}
    >
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        step="any"
        className="num"
        value={value}
        readOnly={readOnly}
        placeholder="Not set"
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
      <FieldError id={`${id}-error`}>{error}</FieldError>
      <QuoteLine
        quote={value === "" ? null : quote}
        review={review && value !== ""}
        onReviewed={readOnly ? undefined : onReviewed}
      />
    </div>
  );
}

function Locations({
  values,
  readOnly,
  review,
  onReviewed,
  quote,
  onFocusQuote,
  onChange,
}: {
  values: string[];
  readOnly: boolean;
  review: boolean;
  onReviewed: () => void;
  quote: string | null;
  onFocusQuote: (quote: string | null) => void;
  onChange: (values: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  return (
    <div
      className="flex flex-col gap-1.5"
      onMouseEnter={() => onFocusQuote(quote)}
      onFocus={() => onFocusQuote(quote)}
    >
      <FieldLabel htmlFor="location-add">Locations</FieldLabel>
      {values.length === 0 && (
        <p className="text-sm text-muted-foreground">No location set.</p>
      )}
      <ul className="flex flex-wrap gap-2">
        {values.map((place) => (
          <li
            key={place}
            className="flex items-center gap-1 rounded-sm bg-muted py-0.5 pl-2 text-sm"
          >
            {place}
            {!readOnly && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 pointer-coarse:h-9"
                aria-label={`Remove ${place}`}
                onClick={() => onChange(values.filter((v) => v !== place))}
              >
                Remove
              </Button>
            )}
          </li>
        ))}
      </ul>
      {!readOnly && (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const place = draft.trim();
            if (
              place &&
              !values.some((v) => v.toLowerCase() === place.toLowerCase())
            ) {
              onChange([...values, place]);
            }
            setDraft("");
          }}
        >
          <Input
            id="location-add"
            placeholder="Add a city"
            value={draft}
            maxLength={60}
            onChange={(e) => setDraft(e.target.value)}
          />
          <Button type="submit" variant="outline">
            Add
          </Button>
        </form>
      )}
      <QuoteLine
        quote={values.length ? quote : null}
        review={review && values.length > 0}
        onReviewed={readOnly ? undefined : onReviewed}
      />
    </div>
  );
}

function JdPane({
  jd,
  quote,
  fileName,
}: {
  jd: string;
  quote: string | null;
  fileName: string | null;
}) {
  const mark = useRef<HTMLElement>(null);
  const hit = useMemo(() => (quote ? findQuote(jd, quote) : null), [jd, quote]);

  useEffect(() => {
    mark.current?.scrollIntoView({ block: "center" });
  }, [hit]);

  return (
    <section aria-label="Job description" className="flex flex-col">
      <div className="flex items-baseline justify-between gap-3 px-4 pt-3 lg:px-0 lg:pt-0">
        <h2>Job description</h2>
        {fileName && (
          <span className="truncate text-sm text-muted-foreground">
            {fileName}
          </span>
        )}
      </div>
      <div className="mt-2 max-h-[70dvh] overflow-y-auto rounded-lg border border-border bg-card p-4 text-sm leading-relaxed whitespace-pre-wrap">
        {hit ? (
          <>
            {jd.slice(0, hit.start)}
            <mark
              ref={mark}
              className="rounded-sm bg-primary-soft text-foreground"
            >
              {jd.slice(hit.start, hit.end)}
            </mark>
            {jd.slice(hit.end)}
          </>
        ) : (
          jd
        )}
      </div>
    </section>
  );
}
