import type { z } from "zod";

// Reads a model reply as JSON, tolerating a code fence around it, and checks it
// against the schema. The problem text is safe to send back to the model.
export function parseReply<S extends z.ZodType>(content: string, schema: S) {
  let json: unknown;
  try {
    json = JSON.parse(
      content
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/, ""),
    );
  } catch {
    return { ok: false as const, problem: "The reply was not valid JSON." };
  }
  const result = schema.safeParse(json);
  if (result.success)
    return { ok: true as const, data: result.data as z.infer<S> };
  return {
    ok: false as const,
    problem: result.error.issues
      .slice(0, 6)
      .map((i) => `${i.path.join(".") || "root"}: ${i.message}`)
      .join("; "),
  };
}
