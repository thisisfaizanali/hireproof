import { canonicalSkill } from "@hireproof/shared";
import { aiConfig } from "../src/ai/llm";
import { parseModel } from "../src/cv/aiProfile";
import {
  FUZZY_THRESHOLD,
  findDuplicate,
  type KnownCandidate,
} from "../src/cv/duplicates";
import { CvExtractError } from "../src/cv/extract";
import { stopOcr } from "../src/cv/ocr";
import { findEmail, findPhone } from "../src/cv/rules";
import { detectType } from "../src/uploads";
import {
  ASOF,
  cvTruth,
  edgeTruth,
  parseSample,
  readSample,
  type CvTruth,
  type Timed,
} from "./cvCorpus";

const pct = (n: number, d: number) =>
  d === 0 ? "n/a" : `${Math.round((n / d) * 100)}% (${n}/${d})`;
const same = (a: unknown, b: unknown) => (a ?? null) === (b ?? null);
const norm = (s: string | null | undefined) =>
  (s ?? "").toLowerCase().replace(/\s+/g, " ").trim();

// "Label : value" on one line, or the label alone with the value after it.
const LABELS =
  /^(date of birth|dob|age|gender|sex|marital status|father'?s name|nationality|languages known)\s*(?:[:-]\s*|$)(.*)$/i;
function personalValues(text: string): string[] {
  const lines = text.split("\n").map((l) => l.trim());
  const values: string[] = [];
  lines.forEach((line, i) => {
    for (const part of line.split(/\s+(?=Marital Status|Gender|Age)/i)) {
      const m = LABELS.exec(part);
      if (!m) continue;
      const value = m[2] || (lines.slice(i + 1).find((l) => l) ?? "");
      if (value && !LABELS.test(value)) values.push(value);
    }
  });
  return values.filter((v) => v.length >= 4);
}

async function main() {
  const model = parseModel();
  console.log(
    model
      ? `Mode: AI profile (${model}) with rules`
      : "Mode: rules only (no AI configured)",
  );
  if (aiConfig() === null && model === null) {
    console.log("Set LLM_API_KEY and LLM_MODEL to include the AI.\n");
  }

  const results: { truth: CvTruth; out: Timed | null; error: string }[] = [];
  for (const truth of cvTruth) {
    try {
      results.push({
        truth,
        out: await parseSample(truth.file, ASOF),
        error: "",
      });
    } catch (err) {
      results.push({
        truth,
        out: null,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const ok = results.filter((r) => r.out);
  const field = (
    pick: (r: { truth: CvTruth; out: Timed }) => boolean,
  ): string =>
    pct(
      ok.filter((r) => pick({ truth: r.truth, out: r.out! })).length,
      ok.length,
    );

  let skillHit = 0;
  let skillFound = 0;
  let skillWanted = 0;
  const skillMisses: string[] = [];
  for (const { truth, out } of ok) {
    const want = new Set(
      truth.skills.map((s) => (canonicalSkill(s) ?? s).toLowerCase()),
    );
    const got = new Set(out!.parsed.profile.skills.map((s) => s.toLowerCase()));
    const hit = [...want].filter((s) => got.has(s));
    skillHit += hit.length;
    skillWanted += want.size;
    skillFound += got.size;
    const missed = [...want].filter((s) => !got.has(s));
    if (missed.length > 0)
      skillMisses.push(`${truth.file}: ${missed.join(", ")}`);
  }

  let leaks = 0;
  const leakNotes: string[] = [];
  for (const { truth, out } of ok) {
    const red = out!.parsed.redactedText;
    const raw = out!.parsed.text;
    const found = [
      ...personalValues(raw).filter((v) => red.includes(v)),
      ...(findEmail(red) ? ["email"] : []),
      ...(findPhone(red) ? ["phone"] : []),
      ...truth.name
        .split(" ")
        .filter((t) => red.toLowerCase().includes(t.toLowerCase())),
    ];
    if (found.length > 0) {
      leaks++;
      leakNotes.push(`${truth.file}: ${found.join(", ")}`);
    }
  }

  const exp = (r: { truth: CvTruth; out: Timed }) => {
    const got = r.out.parsed.profile.totalExperienceYears;
    return got === null
      ? r.truth.totalExperienceYears === 0
      : Math.abs(got - r.truth.totalExperienceYears) <= 0.5;
  };

  console.log("\nField accuracy over the sample CVs");
  console.table({
    "CVs parsed (not failed)": { result: `${ok.length}/${results.length}` },
    name: {
      result: field(
        (r) => norm(r.out.parsed.profile.name) === norm(r.truth.name),
      ),
    },
    email: {
      result: field((r) => same(r.out.parsed.profile.email, r.truth.email)),
    },
    phone: {
      result: field((r) =>
        same(
          r.out.parsed.profile.phone,
          r.truth.phone ? r.truth.phone.replace(/\D/g, "").slice(-10) : null,
        ),
      ),
    },
    "current role": {
      result: field(
        (r) =>
          norm(r.out.parsed.profile.currentRole) ===
            norm(r.truth.currentRole) ||
          // The manifest calls a fresher's role "Fresher", which no CV states.
          (r.out.parsed.profile.currentRole === null &&
            norm(r.truth.currentRole) === "fresher"),
      ),
    },
    location: {
      result: field(
        (r) => norm(r.out.parsed.profile.location) === norm(r.truth.location),
      ),
    },
    "experience (within 0.5 y)": { result: field(exp) },
    "notice days": {
      result: field((r) =>
        same(r.out.parsed.profile.noticeDays, r.truth.noticeDays),
      ),
    },
    "current CTC": {
      result: field((r) =>
        same(r.out.parsed.profile.currentCtcLpa, r.truth.currentCtcLpa),
      ),
    },
    "expected CTC": {
      result: field((r) =>
        same(r.out.parsed.profile.expectedCtcLpa, r.truth.expectedCtcLpa),
      ),
    },
    "skills recall": { result: pct(skillHit, skillWanted) },
    "skills precision": { result: pct(skillHit, skillFound) },
    "scan detected as scan": {
      result: field(
        (r) => (r.out.parsed.textSource === "OCR") === r.truth.isScan,
      ),
    },
    "redaction leaks (must be 0)": { result: String(leaks) },
  });

  const failed = results.filter((r) => !r.out);
  if (failed.length > 0) {
    console.log("\nFailed to parse");
    for (const f of failed) console.log(`  ${f.truth.file}: ${f.error}`);
  }
  if (leakNotes.length > 0) {
    console.log("\nRedaction leaks");
    for (const l of leakNotes) console.log(`  ${l}`);
  }
  if (skillMisses.length > 0) {
    console.log("\nSkills in the ground truth that were not found");
    for (const m of skillMisses) console.log(`  ${m}`);
  }

  console.log("\nCVs flagged for review");
  const reasons: Record<string, number> = {};
  for (const { out } of ok) {
    for (const r of out!.parsed.reviewReasons)
      reasons[r] = (reasons[r] ?? 0) + 1;
  }
  console.table(
    Object.entries(reasons).map(([reason, count]) => ({ reason, count })),
  );

  // Duplicates: parse order as in the manifest, each CV against what came before.
  console.log("\nDuplicate detection");
  const known: KnownCandidate[] = [];
  const foundPairs: {
    file: string;
    kind: string;
    reason: string;
    sim: number | null;
    with: string;
  }[] = [];
  let n = 0;
  for (const { truth, out } of ok) {
    const p = out!.parsed;
    const match = findDuplicate(
      {
        sha256: `sha-${n}`,
        name: p.profile.name,
        email: p.profile.email,
        phone: p.profile.phone,
        text: p.redactedText,
      },
      known,
    );
    if (match) {
      const target = known.find((k) => k.id === match.candidateId)!;
      foundPairs.push({
        file: truth.file,
        kind: match.kind,
        reason: match.reason,
        sim: match.similarity,
        with: target.id,
      });
      target.texts.push(p.redactedText);
      target.fileHashes.push(`sha-${n}`);
    } else {
      known.push({
        id: truth.file,
        name: p.profile.name,
        email: p.profile.email,
        phone: p.profile.phone,
        fileHashes: [`sha-${n}`],
        texts: [p.redactedText],
      });
    }
    n++;
  }
  const groups = new Map<string, string[]>();
  for (const t of cvTruth) {
    if (!t.duplicateGroup) continue;
    groups.set(t.duplicateGroup.key, [
      ...(groups.get(t.duplicateGroup.key) ?? []),
      t.file,
    ]);
  }
  const groupOf = (f: string) =>
    cvTruth.find((t) => t.file === f)?.duplicateGroup?.key;
  let falsePositives = 0;
  const rows = [...groups.entries()].map(([key, files]) => {
    const hit = foundPairs.find(
      (f) => files.includes(f.file) && groupOf(f.with) === key,
    );
    return {
      group: key,
      "expected (manifest)": cvTruth.find((t) => t.file === files[0])!
        .duplicateGroup!.kind,
      "found as": hit
        ? `${hit.kind}: ${hit.reason}${hit.sim ? ` (${hit.sim})` : ""}`
        : "MISSED",
    };
  });
  for (const f of foundPairs) {
    if (!groupOf(f.file) || groupOf(f.file) !== groupOf(f.with))
      falsePositives++;
  }
  console.table(rows);
  console.log(
    `False positives: ${falsePositives}. Fuzzy threshold: ${FUZZY_THRESHOLD}`,
  );

  // Time and tokens
  const total = ok.reduce((s, r) => s + r.out!.ms, 0);
  const tokens = ok.reduce(
    (s, r) =>
      s +
      (r.out!.parsed.run.inputTokens ?? 0) +
      (r.out!.parsed.run.outputTokens ?? 0),
    0,
  );
  console.log(
    `\nTotal ${(total / 1000).toFixed(0)} s for ${ok.length} CVs (${(total / ok.length / 1000).toFixed(1)} s each), ${Math.round(tokens / ok.length)} tokens each`,
  );

  console.log("\nEdge files");
  const edge: Record<string, { got: string; expected: string }> = {};
  for (const e of edgeTruth) {
    const name = e.file.split("/").pop()!;
    const buffer = readSample(e.file);
    let got: string;
    if (!detectType(buffer, name)) {
      got = "rejected at upload: Only PDF and DOCX files are accepted.";
    } else if (buffer.length > 10 * 1024 * 1024) {
      got = "rejected at upload: larger than 10 MB";
    } else {
      try {
        const { parsed } = await parseSample(e.file, ASOF);
        got =
          parsed.reviewReasons.length > 0
            ? `flagged: ${parsed.reviewReasons.join("; ")}`
            : "accepted and parsed";
      } catch (err) {
        got =
          err instanceof CvExtractError
            ? `failed: ${err.message}`
            : `error: ${String(err)}`;
      }
    }
    edge[name] = { got, expected: e.expectedOutcome };
  }
  console.table(edge);
  await stopOcr();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
