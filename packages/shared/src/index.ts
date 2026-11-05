import { z } from "zod";

export const HealthResponse = z.object({
  status: z.literal("ok"),
  db: z.enum(["up", "down"]),
  time: z.string(),
});

export type HealthResponse = z.infer<typeof HealthResponse>;

export const Role = z.enum(["RECRUITER", "CLIENT_HM", "DELIVERY_HEAD"]);
export type Role = z.infer<typeof Role>;

export const Industry = z.enum([
  "IT_SERVICES",
  "BANKING_BACK_OFFICE",
  "RETAIL",
]);
export type Industry = z.infer<typeof Industry>;

export const LoginInput = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, "Enter your email")
    .max(254, "Email is too long")
    .pipe(z.email("Enter a valid email address")),
  password: z
    .string()
    .trim()
    .min(1, "Enter your password")
    .max(200, "Password is too long"),
});
export type LoginInput = z.infer<typeof LoginInput>;

export const SessionUser = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  role: Role,
  client: z.object({ id: z.string(), name: z.string() }).nullable(),
});
export type SessionUser = z.infer<typeof SessionUser>;

export const ClientSummary = z.object({
  id: z.string(),
  name: z.string(),
  industry: Industry,
});
export type ClientSummary = z.infer<typeof ClientSummary>;
