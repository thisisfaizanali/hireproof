import { z } from "zod";

const Env = z.object({
  PORT: z.coerce.number().int().positive(),
  DATABASE_URL: z.string().min(1),
  NODE_ENV: z.string().optional(),
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
