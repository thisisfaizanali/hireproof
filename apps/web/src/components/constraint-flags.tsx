import { CONSTRAINT_LABEL, type ConstraintFlag } from "@hireproof/shared";
import { Flag } from "@/components/cv-status";

// Short text flags, with the full sentence as the tooltip and the accessible
// label. A missing value reads "unknown" and stays neutral.
export function ConstraintFlagList({ flags }: { flags: ConstraintFlag[] }) {
  return (
    <>
      {flags.map((f) => (
        <Flag
          key={f.text}
          tone={f.unknown ? "muted" : "warning"}
          title={f.text}
        >
          <span aria-hidden="true">
            {CONSTRAINT_LABEL[f.kind]}
            {f.unknown ? " unknown" : ""}
          </span>
          <span className="visually-hidden">{f.text}</span>
        </Flag>
      ))}
    </>
  );
}
