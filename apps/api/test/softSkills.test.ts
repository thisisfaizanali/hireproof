import { describe, expect, it } from "vitest";
import {
  SOFT_SKILL_NOTE,
  flagSoftSkills,
  isSoftSkill,
  type LlmScorecard,
} from "@hireproof/shared";
import { finalize } from "../src/ai/extract";
import { rulesScorecard } from "../src/ai/rules";

describe("isSoftSkill", () => {
  it.each([
    "Communication",
    "Good communication skills",
    "Team player",
    "Positive attitude",
    "Interpersonal skills",
    "Willingness to learn",
    "Flexible with shifts",
    "Self-motivated",
  ])("catches %s", (label) => {
    expect(isSoftSkill(label)).toBe(true);
  });

  it.each([
    "Graduate",
    "Java",
    "AML checks",
    "MS Excel",
    "People handling and rostering",
    "Team Lead experience",
    "Store manager experience",
  ])("leaves %s alone", (label) => {
    expect(isSoftSkill(label)).toBe(false);
  });
});

describe("flagSoftSkills", () => {
  const card = (kind: "MUST_HAVE" | "NICE_TO_HAVE") => [
    { kind, label: "Communication", sourceQuote: "q", needsReview: false },
    {
      kind: "MUST_HAVE" as const,
      label: "Graduate",
      sourceQuote: "q",
      needsReview: false,
    },
  ];

  it("flags a soft-skill must-have and says why", () => {
    const out = flagSoftSkills(card("MUST_HAVE"), []);
    expect(out.criteria.map((c) => c.needsReview)).toEqual([true, false]);
    expect(out.ambiguities).toEqual([`Communication: ${SOFT_SKILL_NOTE}.`]);
  });

  it("leaves a nice-to-have alone", () => {
    const out = flagSoftSkills(card("NICE_TO_HAVE"), ["kept"]);
    expect(out.criteria.every((c) => !c.needsReview)).toBe(true);
    expect(out.ambiguities).toEqual(["kept"]);
  });
});

describe("scorecard extraction", () => {
  const jd =
    "We need a KYC analyst. Must have: good communication skills, graduate in any stream.";
  const raw: LlmScorecard = {
    title: null,
    criteria: [
      {
        kind: "MUST_HAVE",
        label: "Communication",
        sourceQuote: "good communication skills",
      },
      {
        kind: "MUST_HAVE",
        label: "Graduate",
        sourceQuote: "graduate in any stream",
      },
    ],
    experience: { minYears: null, maxYears: null, sourceQuote: null },
    notice: { maxDays: null, sourceQuote: null },
    ctc: { maxLpa: null, sourceQuote: null },
    locations: { values: [], sourceQuote: null },
    ambiguities: [],
  };

  it("flags the soft-skill must-have from the AI and keeps a degree as a clean must-have", () => {
    const out = finalize(raw, jd);
    const byLabel = Object.fromEntries(out.criteria.map((c) => [c.label, c]));
    expect(byLabel.Communication).toMatchObject({
      kind: "MUST_HAVE",
      needsReview: true,
    });
    expect(byLabel.Graduate).toMatchObject({
      kind: "MUST_HAVE",
      needsReview: false,
    });
    expect(out.ambiguities.join(" ")).toContain(SOFT_SKILL_NOTE);
  });

  it("raises nothing for the rules extractor, which never makes a must-have", () => {
    const out = rulesScorecard("Java and Spring Boot. Good communication.");
    expect(out.criteria.every((c) => c.kind === "NICE_TO_HAVE")).toBe(true);
    expect(out.ambiguities.join(" ")).not.toContain(SOFT_SKILL_NOTE);
  });
});
