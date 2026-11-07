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

// Fictional accounts created by the API seed and offered as quick logins on the
// demo deployment. `client` is the company name for hiring managers.
export const DEMO_USERS: {
  name: string;
  email: string;
  role: Role;
  client: string | null;
}[] = [
  {
    name: "Ananya Sharma",
    email: "ananya.sharma@hireproof.test",
    role: "RECRUITER",
    client: null,
  },
  {
    name: "Rohan Mehta",
    email: "rohan.mehta@hireproof.test",
    role: "RECRUITER",
    client: null,
  },
  {
    name: "Vikram Rao",
    email: "vikram.rao@hireproof.test",
    role: "DELIVERY_HEAD",
    client: null,
  },
  {
    name: "Priya Nair",
    email: "priya.nair@kestrelinfotech.test",
    role: "CLIENT_HM",
    client: "Kestrel Infotech",
  },
  {
    name: "Arjun Kulkarni",
    email: "arjun.kulkarni@sahyadrifinserv.test",
    role: "CLIENT_HM",
    client: "Sahyadri Finserv",
  },
];

export * from "./scorecard";
export * from "./skills";
export * from "./cv";
export * from "./score";
export * from "./pipeline";
export * from "./data";
export * from "./insights";
