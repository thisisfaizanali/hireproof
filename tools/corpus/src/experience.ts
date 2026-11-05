import type { Role } from "./types.js";

/** CVs are written as if today is November 2026. */
export const AS_OF = "2026-11";

const monthIndex = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return y * 12 + (m - 1);
};

/** Years of work, counting each calendar month once even when roles overlap. */
export function totalExperienceYears(roles: Role[]): number {
  const months = new Set<number>();
  for (const role of roles) {
    const end = monthIndex(role.end ?? AS_OF);
    for (let i = monthIndex(role.start); i < end; i++) months.add(i);
  }
  return Math.round((months.size / 12) * 10) / 10;
}
