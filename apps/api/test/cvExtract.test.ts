import { afterAll, describe, expect, it, vi } from "vitest";
import { aiProfile } from "../src/cv/aiProfile";
import {
  CvExtractError,
  extractCvText,
  type CvFailureCode,
} from "../src/cv/extract";
import { needsOcr, stopOcr } from "../src/cv/ocr";
import { parseCv } from "../src/cv/parse";
import { findEmail } from "../src/cv/rules";
import { ASOF } from "./cvCorpus";
import { sample } from "./samples";

afterAll(stopOcr);

const noAi = (text: string) => aiProfile(text, { model: null });
const parse = (path: string) =>
  parseCv(sample(path), path.split("/").pop()!, { ai: noAi, today: ASOF });

describe("when a PDF needs OCR", () => {
  it.each([
    ["", 1, true],
    ["x".repeat(99), 1, true],
    ["x".repeat(100), 1, false],
    ["x".repeat(250), 3, true],
    ["x".repeat(300), 3, false],
    [`${"x ".repeat(60)}\n\n${"y ".repeat(60)}`, 1, false],
  ])("%j over %i page(s): %s", (text, pages, expected) => {
    expect(needsOcr(text, pages)).toBe(expected);
  });

  it("does not run OCR on a PDF with a text layer", async () => {
    const ocr = vi.fn();
    const out = await extractCvText(
      sample("cvs/Ritika_Bansal_Resume.pdf"),
      "Ritika_Bansal_Resume.pdf",
      { ocr },
    );
    expect(ocr).not.toHaveBeenCalled();
    expect(out).toMatchObject({
      textSource: "TEXT_LAYER",
      ocrConfidence: null,
    });
  });

  it("runs OCR on a scan and flags a low confidence read", async () => {
    const ocr = vi
      .fn()
      .mockResolvedValue({ text: "Some words from a scan", confidence: 55 });
    const onOcr = vi.fn();
    const out = await extractCvText(
      sample("cvs/scan_karthik_resume.pdf"),
      "scan_karthik_resume.pdf",
      { ocr, onOcr },
    );
    expect(onOcr).toHaveBeenCalled();
    expect(out).toMatchObject({
      textSource: "OCR",
      ocrConfidence: 55,
      reviewReasons: ["Scanned CV, text may be misread"],
    });
  });

  it("does not flag a confident read", async () => {
    const ocr = vi.fn().mockResolvedValue({ text: "Words", confidence: 88 });
    const out = await extractCvText(
      sample("cvs/scan_karthik_resume.pdf"),
      "scan_karthik_resume.pdf",
      { ocr },
    );
    expect(out.reviewReasons).toEqual([]);
  });
});

describe("OCR on a real scan", () => {
  it("reads the candidate's email from an image-only PDF", async () => {
    const out = await extractCvText(
      sample("cvs/scan_karthik_resume.pdf"),
      "scan_karthik_resume.pdf",
    );
    expect(out.textSource).toBe("OCR");
    expect(out.ocrConfidence).toBeGreaterThan(60);
    expect(findEmail(out.text)).toBe("karthik.subramanian@example.com");
  }, 90_000);
});

describe("edge files", () => {
  const failure = (path: string) =>
    parse(path).then(
      () => null,
      (err: unknown) => (err instanceof CvExtractError ? err.code : err),
    );

  it.each<[string, CvFailureCode]>([
    ["edge/Vandana_Rawal_Resume.pdf", "corrupt"],
    ["edge/Tarun_Bedi_Resume_protected.pdf", "encrypted"],
    ["edge/Rajiv_Menon_CV.docx", "empty"],
    ["edge/Resume_Gaurav_Sethi.odt", "unsupported"],
  ])("%s is rejected as %s", async (path, code) => {
    expect(await failure(path)).toBe(code);
  });

  it("gives plain reasons", () => {
    expect(new CvExtractError("encrypted").message).toBe(
      "This PDF is password protected.",
    );
    expect(new CvExtractError("corrupt").message).toBe(
      "This file is damaged and cannot be opened.",
    );
  });

  it("flags a cover letter as not a CV", async () => {
    const parsed = await parse("edge/Cover_Letter_Sneha_Iyer.pdf");
    expect(parsed.reviewReasons).toContain(
      "No experience or skills were found, this may not be a CV",
    );
    expect(parsed.profile.skills).toEqual([]);
  });

  it("parses the large valid PDF from its text layer", async () => {
    const parsed = await parse("edge/Kiran_Bhat_Resume_with_certificates.pdf");
    expect(parsed.textSource).toBe("TEXT_LAYER");
    expect(parsed.profile.skills.length).toBeGreaterThan(0);
  });
});
