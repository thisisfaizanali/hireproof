import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { extractScorecard } from "../src/ai/extract";
import { aiConfig } from "../src/ai/llm";
import { readJd, truth } from "./jds";

// Runs the real extractor on each sample JD and keeps the answers, so the seed
// shows genuine model output without needing a key.
async function main() {
  if (!aiConfig()) {
    throw new Error(
      "Set LLM_API_KEY and LLM_MODEL in .env to capture scorecards.",
    );
  }
  const scorecards: Record<string, unknown> = {};
  let model = "";
  for (const jd of truth) {
    const out = await extractScorecard(await readJd(jd.file));
    if (out.source !== "AI") {
      throw new Error(
        `${jd.file}: ${out.run.outcome} ${out.run.errorMessage ?? ""}`,
      );
    }
    model = out.model ?? model;
    scorecards[jd.key] = { scorecard: out.scorecard, source: out.source };
    console.log(`${jd.key}: ${out.run.outcome}, ${out.run.latencyMs} ms`);
  }
  const target = resolve(__dirname, "../prisma/fixtures/scorecards.json");
  writeFileSync(
    target,
    JSON.stringify(
      { model, capturedAt: new Date().toISOString().slice(0, 10), scorecards },
      null,
      2,
    ) + "\n",
  );
  console.log(`Wrote ${target}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
