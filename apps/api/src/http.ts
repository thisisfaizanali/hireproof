import type { Response } from "express";
import type { z } from "zod";

// The first problem as the message, and every problem by field for the form.
export function badInput(res: Response, error: z.ZodError) {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    fields[issue.path.join(".") || "form"] ??= issue.message;
  }
  res
    .status(400)
    .json({ error: error.issues[0]?.message ?? "Check the form", fields });
}
