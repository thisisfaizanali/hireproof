import OpenAI from "openai";
import { z } from "zod";
import { LlmScorecard } from "@hireproof/shared";
import { env } from "../env";

export interface Message {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatResult {
  content: string;
  inputTokens: number | null;
  outputTokens: number | null;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly retryAfterMs: number | null = null,
  ) {
    super(message);
  }
}

export const aiConfig = () =>
  env.LLM_API_KEY && env.LLM_MODEL ? { model: env.LLM_MODEL } : null;

const SCHEMA = z.toJSONSchema(LlmScorecard);
delete SCHEMA.$schema;

let client: OpenAI | undefined;
// Not every model accepts a JSON schema. After one refusal the rest of the
// process uses plain JSON mode.
let structured = true;

function describe(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  const clean = env.LLM_API_KEY
    ? text.split(env.LLM_API_KEY).join("[redacted]")
    : text;
  return clean.slice(0, 300);
}

function toProviderError(err: unknown): ProviderError {
  if (err instanceof OpenAI.APIError) {
    const seconds = Number(err.headers?.get("retry-after"));
    const retryAfterMs = Number.isFinite(seconds) ? seconds * 1000 : null;
    const status = err.status;
    const retryable =
      status === undefined || [408, 409, 429].includes(status) || status >= 500;
    return new ProviderError(
      `${status ?? "network"}: ${describe(err)}`,
      retryable,
      retryAfterMs,
    );
  }
  return new ProviderError(describe(err), false);
}

export async function chat(messages: Message[]): Promise<ChatResult> {
  const config = aiConfig();
  if (!config) throw new ProviderError("AI is not configured", false);
  client ??= new OpenAI({
    apiKey: env.LLM_API_KEY,
    baseURL: env.LLM_BASE_URL,
    timeout: 30_000,
    maxRetries: 0,
  });

  const send = () =>
    client!.chat.completions.create({
      model: config.model,
      messages,
      temperature: 0,
      max_completion_tokens: 2000,
      response_format: structured
        ? {
            type: "json_schema",
            json_schema: { name: "scorecard", strict: true, schema: SCHEMA },
          }
        : { type: "json_object" },
    });

  let response;
  try {
    try {
      response = await send();
    } catch (err) {
      const unsupported =
        structured &&
        err instanceof OpenAI.BadRequestError &&
        /json_schema|response_format|structured/i.test(err.message);
      if (!unsupported) throw err;
      structured = false;
      response = await send();
    }
  } catch (err) {
    throw toProviderError(err);
  }

  return {
    content: response.choices[0]?.message?.content ?? "",
    inputTokens: response.usage?.prompt_tokens ?? null,
    outputTokens: response.usage?.completion_tokens ?? null,
  };
}
