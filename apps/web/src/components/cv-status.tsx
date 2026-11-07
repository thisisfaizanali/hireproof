import type { CvStatus } from "@hireproof/shared";

const base = "inline-block rounded-sm px-2 py-0.5 text-xs font-medium";

const STATUS: Record<CvStatus, [string, string]> = {
  QUEUED: ["Queued", "bg-muted text-foreground"],
  EXTRACTING: ["Reading", "bg-muted text-foreground"],
  OCR: ["Scanning (OCR)", "bg-muted text-foreground"],
  PARSING: ["Parsing", "bg-muted text-foreground"],
  PARSED: ["Done", "bg-success-soft text-success"],
  NEEDS_REVIEW: ["Needs review", "bg-review-soft text-review"],
  FAILED: ["Failed", "bg-destructive-soft text-destructive"],
  DUPLICATE_FILE: ["Duplicate file", "bg-warning-soft text-warning"],
};

export const CV_STATUS_LABEL = Object.fromEntries(
  Object.entries(STATUS).map(([key, [label]]) => [key, label]),
) as Record<CvStatus, string>;

export function CvStatusLabel({ status }: { status: CvStatus }) {
  const [label, tone] = STATUS[status];
  return <span className={`${base} ${tone}`}>{label}</span>;
}

export function Flag({
  tone,
  title,
  children,
}: {
  tone: "review" | "warning" | "muted";
  title?: string;
  children: React.ReactNode;
}) {
  const colours = {
    review: "bg-review-soft text-review",
    warning: "bg-warning-soft text-warning",
    muted: "bg-muted text-foreground",
  }[tone];
  return (
    <span className={`${base} ${colours}`} title={title}>
      {children}
    </span>
  );
}

// Phones are stored as ten digits.
export const formatPhone = (phone: string | null) =>
  phone && phone.length === 10
    ? `+91 ${phone.slice(0, 5)} ${phone.slice(5)}`
    : phone;

export const years = (n: number | null) =>
  n === null ? "Not stated" : `${n} ${n === 1 ? "year" : "years"}`;

export function notice(text: string | null, days: number | null) {
  if (!text) return "Not stated";
  if (days === null) return text;
  return days === 0 ? "Immediate" : `${days} days`;
}
