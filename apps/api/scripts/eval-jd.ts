import { findSkills } from "@hireproof/shared";
import { extractScorecard } from "../src/ai/extract";
import { aiConfig } from "../src/ai/llm";
import { pause, readJd, truth } from "./jds";

// A label counts as every dictionary skill it mentions, or as itself if none.
const skills = (label: string) => {
  const found = findSkills(label).map((s) => s.name.toLowerCase());
  return found.length ? found : [label.toLowerCase()];
};
const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
const mark = (got: unknown, want: unknown) =>
  same(got, want)
    ? "ok"
    : `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`;
const pct = (n: number) => `${Math.round(n * 100)}%`;

async function main() {
  console.log(
    aiConfig() ? `Mode: AI (${aiConfig()!.model})` : "Mode: rules only",
  );
  const rows: Record<string, string>[] = [];
  for (const jd of truth) {
    const { scorecard: s, run } = await extractScorecard(await readJd(jd.file));
    const want = new Set(jd.mustHaveSkills.flatMap(skills));
    const must = new Set(
      s.criteria
        .filter((c) => c.kind === "MUST_HAVE")
        .flatMap((c) => skills(c.label)),
    );
    const any = new Set(s.criteria.flatMap((c) => skills(c.label)));
    const hits = [...must].filter((m) => want.has(m)).length;
    const anyHits = [...want].filter((w) => any.has(w)).length;
    rows.push({
      jd: jd.key,
      outcome: run.outcome,
      expMin: mark(s.experience.minYears, jd.experienceMinYears),
      expMax: mark(s.experience.maxYears, jd.experienceMaxYears),
      notice: mark(s.notice.maxDays, jd.noticeMaxDays),
      ctc: mark(s.ctc.maxLpa, jd.ctcBudgetLpa?.max ?? null),
      locations: mark(
        s.locations.values.map((v) => v.toLowerCase()).sort(),
        jd.locations.map((v) => v.toLowerCase()).sort(),
      ),
      "must recall": pct(want.size ? hits / want.size : 1),
      "must precision": must.size ? pct(hits / must.size) : "n/a",
      "recall, any kind": pct(want.size ? anyHits / want.size : 1),
      tokens: `${run.inputTokens ?? "-"} in, ${run.outputTokens ?? "-"} out, ${run.latencyMs} ms`,
    });
    if (aiConfig() && jd !== truth.at(-1)) await pause();
  }
  console.table(rows);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
