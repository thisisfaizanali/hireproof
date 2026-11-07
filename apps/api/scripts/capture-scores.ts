import { aiConfig, parseDuration } from "../src/ai/llm";
import { aiScore } from "../src/score/ai";
import {
  readScoreFixture,
  targets,
  writeScoreFixture,
  type ScoreFixture,
} from "./scoreCorpus";

// Runs the real scoring prompt through the shared throttle over the sample
// CVs and keeps what the model said, so the seed can show genuine scores
// without a key. Safe to stop and run again: finished CVs are kept.
//   --only <requisition key>   one requisition
//   --limit <n>                at most n new CVs
//   --force                    score again even if already captured
//   --wait                     when the daily token cap is hit, wait for room
//                              and carry on instead of stopping
async function main() {
  const args = process.argv.slice(2);
  const value = (flag: string) =>
    args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined;
  const only = value("--only");
  const limit = value("--limit") ? Number(value("--limit")) : Infinity;
  const force = args.includes("--force");

  const config = aiConfig();
  if (!config)
    throw new Error("Set LLM_API_KEY and LLM_MODEL to capture scores.");

  const fixture: ScoreFixture = (!force && readScoreFixture()) || {
    model: config.model,
    capturedAt: "",
    scores: {},
  };
  fixture.model = config.model;

  let done = 0;
  let tokens = 0;
  let ms = 0;
  for (const target of targets()) {
    if (only && target.key !== only) continue;
    const bucket = (fixture.scores[target.key] ??= {});
    for (const cv of target.cvs) {
      if (done >= limit) break;
      if (bucket[cv.truth.file]) continue;
      const started = Date.now();
      let result = await aiScore(target.card.criteria, cv.redactedText);
      // The provider says how long until a daily cap has room, for example
      // "Please try again in 2m19.104s".
      while (!result.verdicts && args.includes("--wait")) {
        const hint = /try again in ([\dhms.]+)/.exec(
          result.run.errorMessage ?? "",
        );
        if (!hint) break;
        const ms = (parseDuration(hint[1].replace(/\.$/, "")) ?? 60_000) + 5000;
        console.log(`Waiting ${Math.round(ms / 1000)} s for token room`);
        await new Promise((r) => setTimeout(r, ms));
        result = await aiScore(target.card.criteria, cv.redactedText);
      }
      const { run } = result;
      const label = `${target.key} ${cv.truth.file}`;
      if (!result.verdicts) {
        console.log(
          `${label}: ${run.outcome} ${run.errorMessage?.slice(0, 120) ?? ""}`,
        );
        if (run.outcome === "PROVIDER_ERROR") break;
        continue;
      }
      bucket[cv.truth.file] = {
        outcome: run.outcome,
        model: run.model,
        latencyMs: Date.now() - started,
        inputTokens: run.inputTokens,
        outputTokens: run.outputTokens,
        verdicts: result.verdicts.map((v) => ({
          label: target.card.criteria.find((c) => c.id === v.id)!.label,
          verdict: v.verdict,
          quotes: v.quotes,
        })),
      };
      fixture.capturedAt = new Date().toISOString().slice(0, 10);
      writeScoreFixture(fixture);
      done++;
      tokens += (run.inputTokens ?? 0) + (run.outputTokens ?? 0);
      ms += Date.now() - started;
      console.log(
        `${label}: ${run.outcome}, ${run.inputTokens}+${run.outputTokens} tokens, ${((Date.now() - started) / 1000).toFixed(1)} s`,
      );
    }
  }
  if (done > 0) {
    console.log(
      `Captured ${done} CVs: ${Math.round(tokens / done)} tokens and ${(ms / done / 1000).toFixed(1)} s each, ${(ms / 1000).toFixed(0)} s in all`,
    );
  } else {
    console.log("Nothing new to capture.");
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
