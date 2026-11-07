import { findSkills } from "@hireproof/shared";
import { describe, expect, it } from "vitest";
import { computeExperience, findEmail, findPhone } from "../src/cv/rules";
import { redact } from "../src/cv/redact";
import { ASOF, textCorpus } from "./cvCorpus";

// "Label : value" on one line, or the label alone with the value on the next
// non-blank line (how table layouts come out of DOCX).
const LABELS =
  /^(date of birth|dob|age|gender|sex|marital status|father'?s name|nationality|languages known)\s*(?:[:-]\s*|$)(.*)$/i;

function personalValues(text: string): string[] {
  const lines = text.split("\n").map((l) => l.trim());
  const values: string[] = [];
  lines.forEach((line, i) => {
    // One line can carry two fields, as in "Date of Birth: ... Marital Status: ...".
    const parts = line.split(/\s+(?=Marital Status|Gender|Age)/i);
    for (const part of parts) {
      const m = LABELS.exec(part);
      if (!m) continue;
      let value = m[2];
      if (!value) value = lines.slice(i + 1).find((l) => l) ?? "";
      if (value && !LABELS.test(value)) values.push(value);
    }
  });
  return values;
}

describe("redact", () => {
  it("removes every personal value from every CV that has them", async () => {
    let checked = 0;
    for (const { cv, text } of await textCorpus()) {
      // A photo is an image, so there is no text to check for it.
      if (cv.personalFieldsPresent.every((f) => f === "photo")) continue;
      const out = redact(text, cv.name);
      const values = personalValues(text);
      expect(values.length, cv.file).toBeGreaterThan(0);
      // A two-digit age can legitimately appear elsewhere, so it is covered by
      // the label check below instead.
      for (const value of values.filter((v) => v.length >= 4)) {
        expect(out, cv.file).not.toContain(value);
      }
      for (const field of [
        "Date of Birth",
        "Marital Status",
        "Father's Name",
        "Nationality",
        "Gender",
        "Languages Known",
      ]) {
        expect(out, cv.file).not.toContain(field);
      }
      checked++;
    }
    expect(checked).toBeGreaterThanOrEqual(13);
  });

  it("removes the name, email and phone from every CV", async () => {
    for (const { cv, text } of await textCorpus()) {
      const out = redact(text, cv.name);
      expect(findEmail(out), cv.file).toBeNull();
      expect(findPhone(out), cv.file).toBeNull();
      for (const token of cv.name.split(" ")) {
        expect(out.toLowerCase(), cv.file).not.toContain(token.toLowerCase());
      }
    }
  });

  it("keeps the name but drops contact and personal fields for a client", async () => {
    let checked = 0;
    for (const { cv, text } of await textCorpus()) {
      const out = redact(text, cv.name, { keepName: true });
      expect(findEmail(out), cv.file).toBeNull();
      expect(findPhone(out), cv.file).toBeNull();
      const first = cv.name.split(" ")[0].toLowerCase();
      if (text.toLowerCase().includes(first)) {
        expect(out.toLowerCase(), cv.file).toContain(first);
      }
      for (const value of personalValues(text).filter((v) => v.length >= 4)) {
        expect(out, `${cv.file}: ${value}`).not.toContain(value);
      }
      checked++;
    }
    expect(checked).toBeGreaterThan(30);
  });

  it("keeps skills and experience", async () => {
    for (const { cv, text } of await textCorpus()) {
      const out = redact(text, cv.name);
      const kept = new Set(findSkills(out).map((s) => s.name));
      for (const { name } of findSkills(text)) {
        expect(kept.has(name), `${cv.file}: ${name}`).toBe(true);
      }
      expect(computeExperience(out, ASOF), cv.file).toBe(
        computeExperience(text, ASOF),
      );
    }
  });

  it("drops a label and the value on the line after it", () => {
    const out = redact(
      "Skills\nJava\n\nGender\n\nFemale\n\nAge\n\n30\n\nProject work",
      null,
    );
    expect(out).toBe("Skills\nJava\n\nProject work");
  });

  it("keeps a programming languages line", () => {
    expect(redact("Languages: Java, Python", null)).toBe(
      "Languages: Java, Python",
    );
  });

  it("drops a line of spoken languages and a photo caption", () => {
    expect(
      redact("Languages: English, Hindi\nPassport size photo\nJava", null),
    ).toBe("Java");
  });
});
