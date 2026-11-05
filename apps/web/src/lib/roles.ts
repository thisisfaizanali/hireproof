import type { Role } from "@hireproof/shared";

export const ROLE_LABEL: Record<Role, string> = {
  RECRUITER: "Recruiter",
  DELIVERY_HEAD: "Delivery head",
  CLIENT_HM: "Hiring manager",
};

export const homeFor = (role: Role) =>
  role === "CLIENT_HM" ? "/portal" : "/requisitions";
