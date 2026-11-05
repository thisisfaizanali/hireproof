import { describe, expect, it } from "vitest";
import { canonicalSkill } from "@hireproof/shared";
import { rulesScorecard } from "../src/ai/rules";
import { extractText } from "../src/extract";
import { manifest, sample } from "./samples";

describe.each(manifest.jds)("rules fallback: $key", (jd) => {
  it("matches the stated constraints and leaves the rest null", async () => {
    const name = jd.file.split("/").pop()!;
    const { text } = await extractText(sample(jd.file), name);
    const card = rulesScorecard(text);

    expect(card.experience.minYears).toBe(jd.experienceMinYears);
    expect(card.experience.maxYears).toBe(jd.experienceMaxYears);
    expect(card.notice.maxDays).toBe(jd.noticeMaxDays);
    expect(card.ctc.maxLpa).toBe(jd.ctcBudgetLpa?.max ?? null);
    if (jd.key === "kestrel-senior-java" || jd.key === "sahyadri-kyc-analyst") {
      expect(card.locations.values).toEqual(jd.locations);
    }

    const labels = card.criteria.map((c) => c.label);
    for (const skill of jd.mustHaveSkills) {
      expect(labels).toContain(canonicalSkill(skill));
    }
    expect(card.criteria.every((c) => c.kind === "NICE_TO_HAVE")).toBe(true);
    expect(card.criteria.every((c) => c.needsReview && c.sourceQuote)).toBe(
      true,
    );
  });
});

describe("rules fallback gaps", () => {
  it("notes what a JD does not say", async () => {
    const jd = manifest.jds.find((j) => j.key === "marigold-store-ops")!;
    const { text } = await extractText(sample(jd.file), "x.txt");
    const card = rulesScorecard(text);
    expect(card.notice.maxDays).toBeNull();
    expect(card.ctc.maxLpa).toBeNull();
    expect(card.ambiguities.join(" ")).toMatch(/notice/i);
    expect(card.ambiguities.join(" ")).toMatch(/CTC/);
  });

  it("reads immediate joining and months", () => {
    expect(rulesScorecard("Immediate joiners only.").notice.maxDays).toBe(0);
    expect(rulesScorecard("Notice period up to 2 months").notice.maxDays).toBe(
      60,
    );
    expect(
      rulesScorecard("Minimum 3 years of experience").experience,
    ).toMatchObject({
      minYears: 3,
      maxYears: null,
    });
    expect(rulesScorecard("CTC up to 24 lakhs").ctc.maxLpa).toBe(24);
  });
});
