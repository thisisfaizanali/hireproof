import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseModel } from "../src/cv/aiProfile";
import { stopOcr } from "../src/cv/ocr";
import { cvFiles, parseSample } from "./cvCorpus";

// Runs the real pipeline (text, OCR, AI profile through the throttle) over the
// sample CVs and keeps the answers, so the seed shows genuine output without a
// key, a model call or OCR.
async function main() {
  const model = parseModel();
  if (!model) {
    console.warn(
      "No AI configured (LLM_API_KEY and LLM_MODEL): capturing rules-only parses.",
    );
  }
  const parses: Record<string, unknown> = {};
  const started = Date.now();
  let tokens = 0;
  const files = cvFiles();
  for (const file of files) {
    const { parsed, ms } = await parseSample(file);
    tokens += (parsed.run.inputTokens ?? 0) + (parsed.run.outputTokens ?? 0);
    parses[file] = parsed;
    console.log(
      `${file}: ${parsed.textSource}, ${parsed.parseSource}, ${parsed.run.outcome}, ${ms} ms`,
    );
  }
  const seconds = (Date.now() - started) / 1000;
  const target = resolve(__dirname, "../prisma/fixtures/cv-parses.json");
  writeFileSync(
    target,
    JSON.stringify(
      { model, capturedAt: new Date().toISOString().slice(0, 10), parses },
      null,
      2,
    ) + "\n",
  );
  console.log(
    `Wrote ${target}: ${files.length} CVs in ${seconds.toFixed(0)} s (${(seconds / files.length).toFixed(1)} s each, ${Math.round(tokens / files.length)} tokens each)`,
  );
  await stopOcr();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
