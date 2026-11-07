import { createHash } from "node:crypto";

export interface HashableCard {
  criteria: { kind: string; label: string }[];
  experienceMinYears: number | null;
  experienceMaxYears: number | null;
  noticeMaxDays: number | null;
  ctcMaxLpa: number | null;
  locations: string[];
}

// What a score depends on: the criteria and the ranges, not their order, the
// quotes or the review flags.
export function scorecardHash(card: HashableCard) {
  const canonical = {
    criteria: card.criteria
      .map((c) => `${c.kind}:${c.label.trim().toLowerCase()}`)
      .sort(),
    experience: [card.experienceMinYears, card.experienceMaxYears],
    notice: card.noticeMaxDays,
    ctc: card.ctcMaxLpa,
    locations: card.locations.map((l) => l.trim().toLowerCase()).sort(),
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}
