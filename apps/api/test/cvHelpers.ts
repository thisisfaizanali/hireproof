import { createHash } from "node:crypto";
import { prisma } from "../src/db";
import { aiProfile, type AiProfile } from "../src/cv/aiProfile";
import { processCv, type JobDeps } from "../src/cv/job";
import { Throttle } from "../src/cv/throttle";
import type { ChatResult } from "../src/ai/llm";
import { ASOF } from "./cvCorpus";
import { sample } from "./samples";

export async function createRequisition(ownerId: string, title = "Test role") {
  const client = await prisma.client.create({
    data: { name: `Client ${title}`, industry: "IT_SERVICES" },
  });
  return prisma.requisition.create({
    data: { clientId: client.id, ownerId, title, jdText: "A job description." },
  });
}

export async function addCv(
  path: string,
  requisitionId: string,
  uploadedById: string,
  batchId?: string,
) {
  const data = sample(path);
  const batch =
    batchId ??
    (
      await prisma.uploadBatch.create({
        data: { requisitionId, uploadedById, expectedCount: 1 },
      })
    ).id;
  return prisma.cvDocument.create({
    data: {
      batchId: batch,
      requisitionId,
      fileName: path.split("/").pop()!,
      mimeType: path.endsWith(".pdf")
        ? "application/pdf"
        : "application/octet-stream",
      sizeBytes: data.length,
      sha256: createHash("sha256").update(data).digest("hex"),
      data: new Uint8Array(data),
    },
  });
}

export const okReply = (profile: Partial<AiProfile>): ChatResult => ({
  content: JSON.stringify({
    name: null,
    currentRole: null,
    location: null,
    totalExperienceYears: null,
    ...profile,
  }),
  inputTokens: 700,
  outputTokens: 60,
});

// A clock that never waits, so retry and throttle paths run instantly.
export function fakeClock() {
  let now = 1_000_000;
  const slept: number[] = [];
  return {
    slept,
    now: () => now,
    async sleep(ms: number) {
      slept.push(ms);
      now += ms;
    },
  };
}

type Chat = NonNullable<Parameters<typeof aiProfile>[1]>["chat"];

export function deps(chat: Chat, model: string | null = "test-model"): JobDeps {
  const clock = fakeClock();
  return {
    today: () => ASOF,
    ai: (text) =>
      aiProfile(text, { chat, throttle: new Throttle(clock), model }),
  };
}

export const run = (cvId: string, d: JobDeps) => processCv(cvId, d);
