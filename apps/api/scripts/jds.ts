import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { extractText } from "../src/extract";

export const SAMPLES = resolve(__dirname, "../../../samples");

export interface JdTruth {
  file: string;
  key: string;
  client: string;
  title: string;
  mustHaveSkills: string[];
  experienceMinYears: number | null;
  experienceMaxYears: number | null;
  locations: string[];
  noticeMaxDays: number | null;
  ctcBudgetLpa: { min: number; max: number } | null;
}

export const truth: JdTruth[] = JSON.parse(
  readFileSync(resolve(SAMPLES, "manifest.json"), "utf8"),
).jds;

export async function readJd(file: string) {
  const name = file.split("/").pop()!;
  return (await extractText(readFileSync(resolve(SAMPLES, file)), name)).text;
}

export const jdFiles = () =>
  readdirSync(resolve(SAMPLES, "jds")).map((f) => `jds/${f}`);

// The free tier allows a few calls a minute, so scripts leave a gap between them.
export const pause = (ms = 20_000) => new Promise((r) => setTimeout(r, ms));
