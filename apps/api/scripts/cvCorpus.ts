import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { aiProfile } from "../src/cv/aiProfile";
import { parseCv, type ParsedCv } from "../src/cv/parse";
import { SAMPLES } from "./jds";

export interface CvTruth {
  file: string;
  isScan: boolean;
  candidateId: string;
  duplicateGroup: { key: string; kind: string } | null;
  name: string;
  email: string | null;
  phone: string | null;
  currentRole: string | null;
  location: string | null;
  totalExperienceYears: number;
  skills: string[];
  noticeDays: number | null;
  currentCtcLpa: number | null;
  expectedCtcLpa: number | null;
  personalFieldsPresent: string[];
  intendedRequisition: string | null;
}

const manifest = JSON.parse(
  readFileSync(resolve(SAMPLES, "manifest.json"), "utf8"),
) as {
  asOf: string;
  cvs: CvTruth[];
  edge: { file: string; expectedOutcome: string }[];
};

export const cvTruth = manifest.cvs;
export const edgeTruth = manifest.edge;

// The corpus is written as if it were this month, so Present means this month.
export const ASOF = new Date(`${manifest.asOf}-15T00:00:00Z`);

export const readSample = (file: string) =>
  readFileSync(resolve(SAMPLES, file));

export const cvFiles = () =>
  readdirSync(resolve(SAMPLES, "cvs")).map((f) => `cvs/${f}`);

export interface Timed {
  parsed: ParsedCv;
  ms: number;
}

// The same code path the upload job runs, minus the database.
export async function parseSample(
  file: string,
  today: Date = new Date(),
): Promise<Timed> {
  const started = Date.now();
  const parsed = await parseCv(readSample(file), file.split("/").pop()!, {
    ai: (text) => aiProfile(text),
    today,
  });
  return { parsed, ms: Date.now() - started };
}
