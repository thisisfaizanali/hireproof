import type { RequisitionStatus, ScorecardStatus } from "@hireproof/shared";

const base = "inline-block rounded-sm px-2 py-0.5 text-xs font-medium";

const REQUISITION: Record<RequisitionStatus, [string, string]> = {
  DRAFT: ["Draft", "bg-muted text-foreground"],
  OPEN: ["Open", "bg-success-soft text-success"],
  ON_HOLD: ["On hold", "bg-warning-soft text-warning"],
  CLOSED: ["Closed", "bg-muted text-muted-foreground"],
};

export const STATUS_LABEL = Object.fromEntries(
  Object.entries(REQUISITION).map(([key, [label]]) => [key, label]),
) as Record<RequisitionStatus, string>;

export function RequisitionStatusLabel({
  status,
}: {
  status: RequisitionStatus;
}) {
  const [label, tone] = REQUISITION[status];
  return <span className={`${base} ${tone}`}>{label}</span>;
}

export function ScorecardStatusLabel({
  status,
}: {
  status: ScorecardStatus | null;
}) {
  if (status === "CONFIRMED") {
    return (
      <span className={`${base} bg-success-soft text-success`}>Confirmed</span>
    );
  }
  return <span className={`${base} bg-muted text-foreground`}>Draft</span>;
}

export function NeedsReview() {
  return (
    <span className={`${base} bg-review-soft text-review`}>Needs review</span>
  );
}

export const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
