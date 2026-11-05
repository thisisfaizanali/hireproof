import { describe, expect, it } from "vitest";
import { findQuote } from "@hireproof/shared";
import { finalize } from "../src/ai/extract";

const JD = `Experience: 5 to 8 years\nNotice period: up to 60 days.\n\nThe candidate\u2019s \u201cSpring   Boot\u201d skills\nmatter.`;

describe("findQuote", () => {
  it.each([
    ["exact", "5 to 8 years"],
    ["case", "NOTICE PERIOD: UP TO 60 DAYS"],
    ["whitespace", "5   to\n8 years"],
    ["punctuation", "Notice period up to 60 days"],
    ["curly quotes", 'candidate\'s "Spring Boot" skills'],
    ["line breaks", "skills matter"],
  ])("finds a quote that differs by %s", (_label, quote) => {
    expect(findQuote(JD, quote)).not.toBeNull();
  });

  it("returns offsets into the original text", () => {
    const hit = findQuote(JD, "up to 60 days");
    expect(JD.slice(hit!.start, hit!.end)).toBe("up to 60 days");
  });

  it("rejects text that is not in the JD and quotes that are too short", () => {
    expect(findQuote(JD, "Experience: 6 to 9 years")).toBeNull();
    expect(findQuote(JD, "5")).toBeNull();
    expect(findQuote(JD, "")).toBeNull();
  });
});

describe("finalize", () => {
  const empty = {
    title: null,
    criteria: [],
    experience: { minYears: null, maxYears: null, sourceQuote: null },
    notice: { maxDays: null, sourceQuote: null },
    ctc: { maxLpa: null, sourceQuote: null },
    locations: { values: [], sourceQuote: null },
    ambiguities: [],
  };

  it("drops an unverified quote, keeps the value and flags it", () => {
    const out = finalize(
      {
        ...empty,
        notice: { maxDays: 45, sourceQuote: "notice of 45 days" },
        criteria: [
          { kind: "MUST_HAVE", label: "Java", sourceQuote: "invented text" },
        ],
      },
      JD,
    );
    expect(out.notice).toEqual({
      maxDays: 45,
      sourceQuote: null,
      needsReview: true,
    });
    expect(out.criteria[0]).toMatchObject({
      sourceQuote: null,
      needsReview: true,
    });
  });

  it("keeps a verified quote unflagged", () => {
    const out = finalize(
      {
        ...empty,
        experience: { minYears: 5, maxYears: 8, sourceQuote: "5 to 8 years" },
      },
      JD,
    );
    expect(out.experience).toMatchObject({
      sourceQuote: "5 to 8 years",
      needsReview: false,
    });
  });
});
