import type { ExtractionRun } from "../ai/extract";
import type { AskAi } from "./aiProfile";
import { CvExtractError, extractCvText } from "./extract";
import { mergeProfile, type CvProfile } from "./merge";
import type { ocrPdf } from "./ocr";
import { redact } from "./redact";
import { findSkills } from "@hireproof/shared";
import { rulesProfile } from "./rules";

export type CvStage = "EXTRACTING" | "OCR" | "PARSING";

export interface ParsedCv {
  text: string;
  redactedText: string;
  textSource: "TEXT_LAYER" | "OCR";
  ocrConfidence: number | null;
  profile: CvProfile;
  employers: string[];
  reviewReasons: string[];
  parseSource: "AI" | "RULES";
  run: ExtractionRun;
}

export interface ParseDeps {
  ai: AskAi;
  today: Date;
  ocr?: typeof ocrPdf;
  onStage?: (stage: CvStage) => Promise<void> | void;
}

const MIN_SCAN_WORDS = 40;

// The name, plus the words in the email address, which are almost always the
// name too. This keeps the name out of the redacted text even when it was not
// found. Words that are skills ("java.dev@") are left alone.
function nameTokens(profile: CvProfile) {
  const fromEmail = (profile.email ?? "")
    .split("@")[0]
    .split(/[._+\-\d]+/)
    .filter((w) => w.length >= 3 && findSkills(w).length === 0);
  return [profile.name, ...fromEmail].join(" ");
}

// Everything between "bytes in" and "profile out", with no database access, so
// the job, the capture script and the accuracy script all run the same code.
export async function parseCv(
  buffer: Buffer,
  fileName: string,
  deps: ParseDeps,
): Promise<ParsedCv> {
  await deps.onStage?.("EXTRACTING");
  const extracted = await extractCvText(buffer, fileName, {
    ocr: deps.ocr,
    onOcr: () => deps.onStage?.("OCR"),
  });
  const { text } = extracted;

  const rules = rulesProfile(text, deps.today);
  if (extracted.textSource === "OCR") {
    const words = text.split(/\s+/).filter(Boolean).length;
    if (
      !rules.email &&
      !rules.phone &&
      rules.skills.length === 0 &&
      words < MIN_SCAN_WORDS
    ) {
      throw new CvExtractError("unreadableScan");
    }
  }

  await deps.onStage?.("PARSING");
  // The model needs the name but nothing else personal, so it gets the CV
  // with the personal-detail lines and contact numbers already taken out.
  const ai = await deps.ai(redact(text, null));
  const merged = mergeProfile(rules, ai.profile, text);

  return {
    text,
    redactedText: redact(text, nameTokens(merged.profile)),
    textSource: extracted.textSource,
    ocrConfidence: extracted.ocrConfidence,
    profile: merged.profile,
    employers: merged.employers,
    reviewReasons: [
      ...new Set([...extracted.reviewReasons, ...merged.reviewReasons]),
    ],
    parseSource: merged.parseSource,
    run: ai.run,
  };
}

export { CvExtractError };
