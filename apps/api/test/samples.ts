import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Vitest runs from apps/api, two levels below the repository root.
export const SAMPLES = resolve(process.cwd(), "../../samples");

export const sample = (path: string) => readFileSync(resolve(SAMPLES, path));

export const manifest = JSON.parse(sample("manifest.json").toString()) as {
  jds: {
    file: string;
    key: string;
    mustHaveSkills: string[];
    niceToHaveSkills: string[];
    experienceMinYears: number | null;
    experienceMaxYears: number | null;
    locations: string[];
    noticeMaxDays: number | null;
    ctcBudgetLpa: { min: number; max: number } | null;
  }[];
};
