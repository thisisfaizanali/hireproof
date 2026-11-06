import { extractText } from "../src/extract";
import { manifest, sample } from "./samples";

export interface CorpusCv {
  file: string;
  name: string;
  email: string | null;
  phone: string | null;
  isScan: boolean;
  totalExperienceYears: number;
  noticeDays: number | null;
  currentCtcLpa: number | null;
  expectedCtcLpa: number | null;
  skills: string[];
  personalFieldsPresent: string[];
  duplicateGroup: { key: string; kind: string } | null;
}

export const cvs = (manifest as unknown as { cvs: CorpusCv[] }).cvs;

// Text of every CV that has a text layer; scans need OCR and are tested apart.
let cache: Promise<{ cv: CorpusCv; text: string }[]> | undefined;
export function textCorpus() {
  cache ??= Promise.all(
    cvs
      .filter((cv) => !cv.isScan)
      .map(async (cv) => ({
        cv,
        text: (await extractText(sample(cv.file), cv.file.split("/").pop()!))
          .text,
      })),
  );
  return cache;
}

// "now" for the corpus: the manifest computes experience as of November 2026.
export const ASOF = new Date(Date.UTC(2026, 10, 15));
