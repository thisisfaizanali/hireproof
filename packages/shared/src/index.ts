import { z } from "zod";

export const HealthResponse = z.object({
  status: z.literal("ok"),
  db: z.enum(["up", "down"]),
  time: z.string(),
});

export type HealthResponse = z.infer<typeof HealthResponse>;
