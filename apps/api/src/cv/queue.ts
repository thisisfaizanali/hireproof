import { PgBoss } from "pg-boss";
import { env } from "../env";
import { processCv, stuckCvIds } from "./job";
import { stopOcr } from "./ocr";
import { processScore, stuckScoreIds } from "../score/job";
import { setScoreSender, type ScoreJob } from "../score/trigger";

const QUEUE = "cv-parse";
const SCORE_QUEUE = "cv-score";
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
  // Scoring waits on the shared model throttle, so one at a time is enough.
  await instance.createQueue(SCORE_QUEUE, {
    retryLimit: 2,
    expireInSeconds: 900,
  });
  await instance.work<ScoreJob>(
    SCORE_QUEUE,
    { localConcurrency: 1, batchSize: 1 },
    async ([job]) => {
      await processScore(job.data.applicationId, undefined, job.data.force);
    },
  );
  boss = instance;
  setScoreSender((job) => instance.send(SCORE_QUEUE, job));
  for (const cvId of await stuckCvIds()) await instance.send(QUEUE, { cvId });
  for (const applicationId of await stuckScoreIds()) {
    await instance.send(SCORE_QUEUE, { applicationId });
  }
}

// Without a running queue (tests, scripts) a CV simply stays queued.
export async function enqueueCv(cvId: string) {
  await boss?.send(QUEUE, { cvId });
}

export async function stopQueue() {
  const instance = boss;
  boss = undefined;
  setScoreSender(undefined);
  await instance?.stop({ graceful: true, timeout: 15_000 });
  await stopOcr();
}
