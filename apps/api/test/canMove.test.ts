import { describe, expect, it } from "vitest";
import { Role, Stage, canMove } from "@hireproof/shared";

// Written out in full so a change to the rules has to change this list too.
const ALLOWED: Record<string, string[]> = {
  RECRUITER: [
    "SOURCED>SCREENED",
    "SOURCED>REJECTED",
    "SCREENED>REJECTED",
    "REJECTED>SOURCED",
    "SCREENED>SUBMITTED",
    "SUBMITTED>WITHDRAWN",
    "CLIENT_SHORTLISTED>INTERVIEW",
    "INTERVIEW>OFFERED",
    "INTERVIEW>REJECTED",
    "OFFERED>JOINED",
    "OFFERED>WITHDRAWN",
  ],
  CLIENT_HM: ["SUBMITTED>CLIENT_SHORTLISTED", "SUBMITTED>REJECTED"],
  DELIVERY_HEAD: [],
};

const pairs = Role.options.flatMap((role) =>
  Stage.options.flatMap((from) =>
    Stage.options.map((to) => [role, from, to] as const),
  ),
);

describe("canMove", () => {
  it("covers every role and every pair of stages", () => {
    expect(pairs).toHaveLength(3 * 9 * 9);
  });

  it.each(pairs)("%s: %s to %s", (role, from, to) => {
    expect(canMove(from, to, role)).toBe(
      ALLOWED[role].includes(`${from}>${to}`),
    );
  });

  it("never moves a candidate out of joined or withdrawn", () => {
    for (const role of Role.options) {
      for (const to of Stage.options) {
        expect(canMove("JOINED", to, role)).toBe(false);
        expect(canMove("WITHDRAWN", to, role)).toBe(false);
      }
    }
  });

  it("gives the delivery head no moves at all", () => {
    expect(
      pairs.filter(([r, f, t]) => r === "DELIVERY_HEAD" && canMove(f, t, r)),
    ).toEqual([]);
  });
});
