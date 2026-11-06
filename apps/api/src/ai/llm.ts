import OpenAI from "openai";
import { z } from "zod";
import { LlmScorecard } from "@hireproof/shared";
import { env } from "../env";

export interface Message {
  role: "system" | "user" | "assistant";
  content: string;
}

// What the provider says is left of its budgets, read from x-ratelimit-* headers.
export interface RateLimits {
  remainingTokens: number | null;
  resetTokensMs: number | null;
  remainingRequests: number | null;
  resetRequestsMs: number | null;
}

export interface ChatResult {
  content: string;
  inputTokens: number | null;
  outputTokens: number | null;
  limits?: RateLimits | null;
}

export interface ChatOptions {
  model?: string;
  schema?: Record<string, unknown>;
  schemaName?: string;
  maxTokens?: number;
  reasoningEffort?: "low" | "medium" | "high";
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly retryAfterMs: number | null = null,
    readonly status: number | null = null,
  ) {
    super(message);
  }
}

export const aiConfig = () =>
  env.LLM_API_KEY && env.LLM_MODEL ? { model: env.LLM_MODEL } : null;

const SCORECARD_SCHEMA = z.toJSONSchema(LlmScorecard);
delete SCORECARD_SCHEMA.$schema;

let client: OpenAI | undefined;
// Not every model accepts a JSON schema. After one refusal that schema is
// sent as plain JSON mode for the rest of the process.
const plainJson = new Set<string>();

// "7.66s", "1m26.4s", "250ms" as the provider writes reset times.
export function parseDuration(value: string | null | undefined) {
  if (!value) return null;
  const match =
    /^(?:(\d+(?:\.\d+)?)h)?(?:(\d+(?:\.\d+)?)m(?!s))?(?:(\d+(?:\.\d+)?)s)?(?:(\d+(?:\.\d+)?)ms)?$/.exec(
      value.trim(),
    );
  if (!match || !match[0]) return null;
  const [, h, m, s, ms] = match.map(Number);
  return (h || 0) * 3_600_000 + (m || 0) * 60_000 + (s || 0) * 1000 + (ms || 0);
}

const asNumber = (value: string | null | undefined) => {
  const n = value == null ? NaN : Number(value);
  return Number.isFinite(n) ? n : null;
};

function readLimits(headers: Headers): RateLimits | null {
  const limits = {
    remainingTokens: asNumber(headers.get("x-ratelimit-remaining-tokens")),
    resetTokensMs: parseDuration(headers.get("x-ratelimit-reset-tokens")),
    remainingRequests: asNumber(headers.get("x-ratelimit-remaining-requests")),
    resetRequestsMs: parseDuration(headers.get("x-ratelimit-reset-requests")),
  };
  return Object.values(limits).some((v) => v !== null) ? limits : null;
}

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
      status ?? null,
    );
  }
  return new ProviderError(describe(err), false);
}

export async function chat(
  messages: Message[],
  options: ChatOptions = {},
): Promise<ChatResult> {
  const config = aiConfig();
  const model = options.model ?? config?.model;
  if (!env.LLM_API_KEY || !model) {
    throw new ProviderError("AI is not configured", false);
  }
  const schemaName = options.schemaName ?? "scorecard";
  const schema = options.schema ?? SCORECARD_SCHEMA;
  client ??= new OpenAI({
    apiKey: env.LLM_API_KEY,
    baseURL: env.LLM_BASE_URL,
    timeout: 30_000,
    maxRetries: 0,
  });

  const send = () =>
    client!.chat.completions
      .create({
        model,
        messages,
        temperature: 0,
        max_completion_tokens: options.maxTokens ?? 4000,
        ...(options.reasoningEffort && {
          reasoning_effort: options.reasoningEffort,
        }),
        response_format: plainJson.has(model + schemaName)
          ? { type: "json_object" }
          : {
              type: "json_schema",
              json_schema: { name: schemaName, strict: true, schema },
            },
      })
      .withResponse();

  let response;
  try {
    try {
      response = await send();
    } catch (err) {
      const unsupported =
        !plainJson.has(model + schemaName) &&
        err instanceof OpenAI.BadRequestError &&
        /json_schema|response_format|structured/i.test(err.message);
      if (!unsupported) throw err;
      plainJson.add(model + schemaName);
      response = await send();
    }
  } catch (err) {
    throw toProviderError(err);
  }

  const { data, response: raw } = response;
  return {
    content: data.choices[0]?.message?.content ?? "",
    inputTokens: data.usage?.prompt_tokens ?? null,
    outputTokens: data.usage?.completion_tokens ?? null,
    limits: readLimits(raw.headers),
  };
}
