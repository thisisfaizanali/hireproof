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
});

function loadEnv(source: NodeJS.ProcessEnv = process.env) {
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
