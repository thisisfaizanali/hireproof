import { describe, expect, it } from "vitest";
import {
  FUZZY_THRESHOLD,
  findDuplicate,
  similarity,
  type KnownCandidate,
} from "../src/cv/duplicates";
import { guessName } from "../src/cv/merge";
import { redact } from "../src/cv/redact";
import { findEmail, findPhone } from "../src/cv/rules";
import { textCorpus } from "./cvCorpus";

describe("findDuplicate over the corpus", () => {
  it("finds the three groups with the right kind and nothing else", async () => {
    const known: KnownCandidate[] = [];
    const found: Record<string, string> = {};
    let n = 0;
    for (const { cv, text } of await textCorpus()) {
      const email = findEmail(text);
      const phone = findPhone(text);
      const name = guessName(text, email) ?? cv.name;
      const redacted = redact(text, name);
      const match = findDuplicate(
        { sha256: `hash-${n}`, name, email, phone, text: redacted },
        known,
      );
      if (match) found[cv.file] = match.kind;
      if (match) {
        const target = known.find((k) => k.id === match.candidateId)!;
        target.texts.push(redacted);
        target.fileHashes.push(`hash-${n}`);
      } else {
        known.push({
          id: `c${n}`,
          name,
          email,
          phone,
          fileHashes: [`hash-${n}`],
          texts: [redacted],
        });
      }
      n++;
    }
    // The second file of each pair is the one that matches the first.
    expect(found).toEqual({
      "cvs/Ritika Bansal - Updated Resume.docx": "CONTACT",
      "cvs/TanviJoshi_CV_old.pdf": "CONTACT",
      "cvs/Rohit_Saxena_Resume_latest.pdf": "FUZZY",
    });
  });

  it("scores the fuzzy pair above the threshold and every other pair below", async () => {
    const docs = (await textCorpus()).map(({ cv, text }) => ({
      cv,
      text: redact(text, cv.name),
    }));
    for (let i = 0; i < docs.length; i++) {
      for (let j = i + 1; j < docs.length; j++) {
        const score = similarity(docs[i].text, docs[j].text);
        const pair = [docs[i].cv, docs[j].cv];
        const groups = pair.map((c) => c.duplicateGroup?.key);
        const sameGroup = groups[0] !== undefined && groups[0] === groups[1];
        if (groups[0] === "dup-rohit" && sameGroup) {
          expect(score).toBeGreaterThanOrEqual(FUZZY_THRESHOLD);
        } else if (!sameGroup) {
          expect(score, pair.map((c) => c.file).join(" | ")).toBeLessThan(
            FUZZY_THRESHOLD,
          );
        }
      }
    }
  });
});

describe("findDuplicate tiers", () => {
  const person: KnownCandidate = {
    id: "c1",
    name: "Asha Rao",
    email: "asha@example.com",
    phone: "9000011111",
    fileHashes: ["abc"],
    texts: ["java spring boot rest api developer noida"],
  };
  const cv = {
    sha256: "zzz",
    name: "Someone Else",
    email: null,
    phone: null,
    text: "x",
  };

  it("matches the same bytes first", () => {
    expect(findDuplicate({ ...cv, sha256: "abc" }, [person])).toMatchObject({
      kind: "EXACT_FILE",
      candidateId: "c1",
    });
  });

  it("matches the same email or phone", () => {
    expect(
      findDuplicate({ ...cv, email: "asha@example.com" }, [person]),
    ).toMatchObject({ kind: "CONTACT", reason: "Same email address" });
    expect(
      findDuplicate({ ...cv, phone: "9000011111" }, [person]),
    ).toMatchObject({ kind: "CONTACT", reason: "Same phone number" });
  });

  it("does not match a similar CV under a different name", () => {
    expect(
      findDuplicate({ ...cv, text: person.texts[0] }, [person]),
    ).toBeNull();
  });

  it("matches the same name in a different word order with a similar CV", () => {
    const text =
      "java spring boot rest api developer noida with five years of work";
    const match = findDuplicate({ ...cv, name: "Rao, Asha", text }, [
      { ...person, texts: [text] },
    ]);
    expect(match).toMatchObject({ kind: "FUZZY", similarity: 1 });
  });
});
