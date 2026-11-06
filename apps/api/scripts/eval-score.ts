import { aiConfig } from "../src/ai/llm";
import { aiScore } from "../src/score/ai";
import { computeScore, type ComputedScore } from "../src/score/compute";
import { verifyEvidence, type RawVerdict } from "../src/score/evidence";
import { rulesScore } from "../src/score/rules";
import {
  fixtureVerdicts,
  readScoreFixture,
  targets,
  type Target,
} from "./scoreCorpus";

// Compares the ranking each way of scoring gives with the expected fit in the
// sample manifest, one requisition at a time. Prints tables and writes nothing.
// The AI column replays the verdicts saved by `capture:scores` through the same
// evidence check and formula the app uses; pass --live to ask the model again.
type Fit = "strong" | "partial" | "poor";
const ORDINAL: Record<Fit, number> = { poor: 0, partial: 1, strong: 2 };
const BAND_ORDER = { STRONG: 0, POSSIBLE: 1, WEAK: 2 } as const;

interface Row {
  file: string;
  fit: Fit;
  adversarial: string | null;
  result: ComputedScore;
  quotes: number;
  verified: number;
  rank: number;
}

const pct = (n: number, d: number) =>
  d === 0 ? "n/a" : `${Math.round((n / d) * 100)}% (${n}/${d})`;

function averageRanks(values: number[]) {
  const order = values
    .map((v, i) => [v, i] as const)
    .sort((a, b) => a[0] - b[0]);
  const ranks = new Array<number>(values.length);
  for (let i = 0; i < order.length;) {
    let j = i;
    while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++;
    for (let k = i; k <= j; k++) ranks[order[k][1]] = (i + j) / 2 + 1;
    i = j + 1;
  }
  return ranks;
}

function spearman(x: number[], y: number[]) {
  const a = averageRanks(x);
  const b = averageRanks(y);
  const mean = (v: number[]) => v.reduce((s, n) => s + n, 0) / v.length;
  const ma = mean(a);
  const mb = mean(b);
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < a.length; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return da === 0 || db === 0 ? 0 : num / Math.sqrt(da * db);
}

async function scoreAll(
  target: Target,
  mode: "ai" | "rules",
  live: boolean,
  fixture: ReturnType<typeof readScoreFixture>,
): Promise<Row[]> {
  const rows: Omit<Row, "rank">[] = [];
  for (const cv of target.cvs) {
    let raw: RawVerdict[] | null;
    if (mode === "rules") {
      raw = rulesScore(target.card.criteria, cv.redactedText);
    } else if (live) {
      raw = (await aiScore(target.card.criteria, cv.redactedText)).verdicts;
    } else {
      const captured = fixture?.scores[target.key]?.[cv.truth.file];
      raw = captured ? fixtureVerdicts(captured, target.card.criteria) : null;
    }
    if (!raw) continue;
    const resolved = verifyEvidence(target.card.criteria, raw, cv.redactedText);
    const result = computeScore(
      target.card,
      resolved,
      cv.profile,
      mode === "ai" ? "AI" : "RULES",
    );
    const quotes = result.criteria.flatMap((c) => c.quotes);
    rows.push({
      file: cv.truth.file,
      fit: cv.truth.expectedFit as Fit,
      adversarial: cv.truth.adversarial,
      result,
      quotes: quotes.length,
      verified: quotes.filter((q) => q.verified).length,
    });
  }
  rows.sort(
    (a, b) =>
      BAND_ORDER[a.result.band] - BAND_ORDER[b.result.band] ||
      b.result.total - a.result.total ||
      b.result.mustHavesMet - a.result.mustHavesMet ||
      a.file.localeCompare(b.file),
  );
  return rows.map((r, i) => ({ ...r, rank: i + 1 }));
}

async function main() {
  const live = process.argv.includes("--live");
  if (live && !aiConfig())
    throw new Error("--live needs LLM_API_KEY and LLM_MODEL.");
  const fixture = readScoreFixture();
  if (!live && !fixture) {
    console.log(
      "No captured scores: run capture:scores first. Showing rules only.\n",
    );
  }
  console.log(
    live
      ? `AI column: live, ${aiConfig()!.model}`
      : `AI column: captured ${fixture?.capturedAt ?? "-"}, ${fixture?.model ?? "none"}`,
  );

  const all = targets();
  const modes = ["ai", "rules"] as const;
  const results = new Map<string, Map<string, Row[]>>();
  for (const mode of modes) {
    const byKey = new Map<string, Row[]>();
    for (const t of all)
      byKey.set(t.key, await scoreAll(t, mode, live, fixture));
    results.set(mode, byKey);
  }

  const summary: Record<string, Record<string, string>> = {};
  for (const mode of modes) {
    const rows = [...results.get(mode)!.values()];
    const flat = rows.flat();
    const strongPicked = flat.filter((r) => r.result.band === "STRONG");
    const strongRight = strongPicked.filter((r) => r.fit === "strong");
    const strongWanted = flat.filter((r) => r.fit === "strong");
    const inTop10 = rows
      .flatMap((r) => r.slice(0, 10))
      .filter((r) => r.fit === "strong");
    const weakStrong = flat.filter(
      (r) => r.result.band === "WEAK" && r.fit === "strong",
    );
    const quotes = flat.reduce((s, r) => s + r.quotes, 0);
    const verified = flat.reduce((s, r) => s + r.verified, 0);
    const downgraded = flat.reduce(
      (s, r) => s + r.result.criteria.filter((c) => c.flag).length,
      0,
    );
    const rhos = rows
      .filter((r) => r.length > 2)
      .map((r) =>
        spearman(
          r.map((x) => -x.rank),
          r.map((x) => ORDINAL[x.fit]),
        ),
      );
    summary[mode === "ai" ? "AI" : "Rules"] = {
      "CVs scored": String(flat.length),
      "Precision of Strong": pct(strongRight.length, strongPicked.length),
      "Expected-strong found as Strong": pct(
        strongRight.length,
        strongWanted.length,
      ),
      "Expected-strong in the top 10": pct(inTop10.length, strongWanted.length),
      "Expected-strong banded Weak": String(weakStrong.length),
      "Spearman (mean over requisitions)": rhos.length
        ? (rhos.reduce((s, n) => s + n, 0) / rhos.length).toFixed(2)
        : "n/a",
      "Quotes that verify": pct(verified, quotes),
      "Criteria downgraded for a missing quote": String(downgraded),
    };
  }
  console.log("\nRanking against the expected fit");
  console.table(summary);

  console.log("\nPer requisition");
  const perReq: Record<string, Record<string, string>> = {};
  for (const t of all) {
    for (const mode of modes) {
      const rows = results.get(mode)!.get(t.key)!;
      if (rows.length === 0) continue;
      const strong = rows.filter((r) => r.fit === "strong");
      const picked = rows.filter((r) => r.result.band === "STRONG");
      perReq[`${t.key} (${mode === "ai" ? "AI" : "Rules"})`] = {
        CVs: String(rows.length),
        "Expected strong": String(strong.length),
        "Banded Strong": String(picked.length),
        "Strong correct": String(
          picked.filter((r) => r.fit === "strong").length,
        ),
        "Strong in top 10": String(
          rows.slice(0, 10).filter((r) => r.fit === "strong").length,
        ),
        Spearman: spearman(
          rows.map((x) => -x.rank),
          rows.map((x) => ORDINAL[x.fit]),
        ).toFixed(2),
      };
    }
  }
  console.table(perReq);

  console.log("\nAdversarial CVs");
  const adversarial: Record<string, Record<string, string>> = {};
  for (const mode of modes) {
    for (const [key, rows] of results.get(mode)!) {
      for (const r of rows.filter((x) => x.adversarial)) {
        const listed = r.result.criteria
          .map((c) => `${c.label}:${c.verdict}`)
          .join(", ");
        adversarial[
          `${r.file.split("/").pop()} (${mode === "ai" ? "AI" : "Rules"})`
        ] = {
          kind: r.adversarial!,
          requisition: key,
          band: r.result.band,
          score: String(r.result.total),
          rank: `${r.rank} of ${rows.length}`,
          verdicts: listed,
        };
      }
    }
  }
  console.table(adversarial);

  console.log("\nBand against expected fit (AI)");
  const grid: Record<string, Record<string, number>> = {};
  for (const r of [...results.get("ai")!.values()].flat()) {
    const row = (grid[`expected ${r.fit}`] ??= {
      STRONG: 0,
      POSSIBLE: 0,
      WEAK: 0,
    });
    row[r.result.band]++;
  }
  console.table(grid);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
