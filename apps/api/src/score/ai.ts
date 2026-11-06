import type { AiOutcome } from "@hireproof/shared";
import type { ExtractionRun } from "../ai/extract";
import {
  ProviderError,
  aiConfig,
  chat,
  type ChatResult,
  type Message,
} from "../ai/llm";
import { parseReply } from "../ai/reply";
import { cvThrottle, type Throttle } from "../cv/throttle";
import type { RawVerdict } from "./evidence";
import {
  AiScore,
  MAX_OUTPUT_TOKENS,
  SCORE_SCHEMA,
  scorePrompt,
  type PromptCriterion,
} from "./prompt";

export interface AiScoreResult {
  verdicts: RawVerdict[] | null;
  run: ExtractionRun;
}

export type AskScore = (
  criteria: PromptCriterion[],
  redactedText: string,
) => Promise<AiScoreResult>;

export interface AiScoreDeps {
  chat?: typeof chat;
  throttle?: Throttle;
  model?: string | null;
}

// Any failure comes back as null verdicts plus a run record, never a throw, so
// a candidate is still scored by rules when the AI is unavailable.
export async function aiScore(
  criteria: PromptCriterion[],
  redactedText: string,
  deps: AiScoreDeps = {},
): Promise<AiScoreResult> {
  const send = deps.chat ?? chat;
  const throttle = deps.throttle ?? cvThrottle;
  const model = deps.model === undefined ? aiConfig()?.model : deps.model;
  const started = Date.now();
  let inputTokens: number | null = null;
  let outputTokens: number | null = null;
  let retried = false;

  const finish = (
    outcome: AiOutcome,
    errorMessage: string | null,
    verdicts: RawVerdict[] | null = null,
  ): AiScoreResult => ({
    verdicts,
    run: {
      model: model ?? "rules",
      outcome,
      latencyMs: Date.now() - started,
      inputTokens,
      outputTokens,
      errorMessage,
    },
  });

  if (!model) return finish("NOT_CONFIGURED", null);

  const ask = async (messages: Message[]): Promise<ChatResult> => {
    const estimate =
      Math.ceil(messages.reduce((n, m) => n + m.content.length, 0) / 3) +
      MAX_OUTPUT_TOKENS / 2;
    const result = await throttle.run(estimate, () =>
      send(messages, {
        model,
        schema: SCORE_SCHEMA,
        schemaName: "cv_score",
        maxTokens: MAX_OUTPUT_TOKENS,
        reasoningEffort: model.includes("gpt-oss") ? "low" : undefined,
      }),
    );
    inputTokens = (inputTokens ?? 0) + (result.inputTokens ?? 0);
    outputTokens = (outputTokens ?? 0) + (result.outputTokens ?? 0);
    return result;
  };

  const { messages, ids } = scorePrompt(criteria, redactedText);
  const toVerdicts = (data: AiScore): RawVerdict[] =>
    data.results.flatMap((r) => {
      const id = ids.get(r.id);
      return id ? [{ id, verdict: r.verdict, quotes: r.quotes }] : [];
    });

  try {
    let reply = await ask(messages);
    let parsed = parseReply(reply.content, AiScore);
    if (!parsed.ok) {
      retried = true;
      reply = await ask([
        ...messages,
        { role: "assistant", content: reply.content.slice(0, 1500) },
        {
          role: "user",
          content: `That reply did not match the required shape: ${parsed.problem} Reply again with one corrected JSON object only.`,
        },
      ]);
      parsed = parseReply(reply.content, AiScore);
      if (!parsed.ok) return finish("INVALID_OUTPUT", parsed.problem);
    }
    return finish(retried ? "RETRIED_OK" : "OK", null, toVerdicts(parsed.data));
  } catch (err) {
    if (err instanceof ProviderError) {
      return finish("PROVIDER_ERROR", err.message);
    }
    throw err;
  }
}
