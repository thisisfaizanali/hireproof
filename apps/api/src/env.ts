import { z } from "zod";

// An empty value in .env means "not set".
const blankAsUnset = (value: unknown) => (value === "" ? undefined : value);

const Env = z.object({
  PORT: z.coerce.number().int().positive(),
  DATABASE_URL: z.string().min(1),
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  // Optional: without them the app falls back to pattern matching.
  LLM_BASE_URL: z.preprocess(
    blankAsUnset,
    z.url().default("https://api.groq.com/openai/v1"),
  ),
  LLM_API_KEY: z.preprocess(blankAsUnset, z.string().optional()),
  LLM_MODEL: z.preprocess(blankAsUnset, z.string().optional()),
  // Model for reading CVs; falls back to LLM_MODEL.
  LLM_PARSE_MODEL: z.preprocess(blankAsUnset, z.string().optional()),
  // How many proxies sit between the browser and this process. Express reads the
  // client address that many entries from the right of X-Forwarded-For.
  TRUST_PROXY: z.preprocess(
    blankAsUnset,
    z.coerce.number().int().min(0).max(10).default(1),
  ),
  // CVs read (text, OCR, parse) at the same time. Each OCR worker holds a
  // few hundred MB, so a 512 MB host should use 1.
  CV_CONCURRENCY: z.preprocess(
    blankAsUnset,
    z.coerce.number().int().min(1).max(8).default(2),
  ),
});

export function loadEnv(source: NodeJS.ProcessEnv = process.env) {
  const result = Env.safeParse(source);
  if (!result.success) {
    const lines = result.error.issues.map(
      (issue) => `  ${issue.path.join(".")}: ${issue.message}`,
    );
    throw new Error(`Invalid environment:\n${lines.join("\n")}`);
  }
  return result.data;
}

export const env = loadEnv();
