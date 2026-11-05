import type { Candidate, Pool, Role } from "../types.js";

/** Short role builder: end is "now" for the current role. */
export const r = (
  title: string,
  company: string,
  city: string,
  start: string,
  end: string,
  bullets: string[],
): Role => ({
  title,
  company,
  city,
  start,
  end: end === "now" ? null : end,
  bullets,
});

/** Fake phone numbers in the +91 90000 1xxxx block. */
export const ph = (n: number) => `+91 90000 1${String(n).padStart(4, "0")}`;

type Input = Omit<
  Candidate,
  | "pool"
  | "requisition"
  | "currentRole"
  | "noticeDays"
  | "currentCtcLpa"
  | "expectedCtcLpa"
  | "dateStyle"
> &
  Partial<
    Pick<
      Candidate,
      | "currentRole"
      | "noticeDays"
      | "currentCtcLpa"
      | "expectedCtcLpa"
      | "dateStyle"
    >
  >;

export const make =
  (pool: Pool, requisition: string | null) =>
  (c: Input): Candidate => ({
    pool,
    requisition,
    currentRole: c.roles.at(-1)?.title ?? "Fresher",
    noticeDays: null,
    currentCtcLpa: null,
    expectedCtcLpa: null,
    dateStyle: "short",
    ...c,
  });
