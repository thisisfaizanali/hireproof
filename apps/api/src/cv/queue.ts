import { PgBoss } from "pg-boss";
import { env } from "../env";
import { processCv, stuckCvIds } from "./job";
import { stopOcr } from "./ocr";

const QUEUE = "cv-parse";
// Extraction and OCR are the heavy steps; two at a time keeps one small server
// responsive. The LLM calls behind them go through one shared throttle.
const CONCURRENCY = 2;

// pg-boss runs inside the API process so there is one service to deploy. Move
// it to a separate worker process when upload volume needs it.
let boss: PgBoss | undefined;

export async function startQueue() {
  if (boss) return;
  const instance = new PgBoss({ connectionString: env.DATABASE_URL });
  instance.on("error", (err) => console.error("queue error", err));
  await instance.start();
  await instance.createQueue(QUEUE, { retryLimit: 2, expireInSeconds: 900 });
  await instance.work<{ cvId: string }>(
    QUEUE,
    { localConcurrency: CONCURRENCY, batchSize: 1 },
    async ([job]) => {
      await processCv(job.data.cvId);
    },
  );
  boss = instance;
  for (const cvId of await stuckCvIds()) await instance.send(QUEUE, { cvId });
}

// Without a running queue (tests, scripts) a CV simply stays queued.
export async function enqueueCv(cvId: string) {
  await boss?.send(QUEUE, { cvId });
}

export async function stopQueue() {
  const instance = boss;
  boss = undefined;
  await instance?.stop({ graceful: true, timeout: 15_000 });
  await stopOcr();
}
