import { findQuote, type Verdict } from "@hireproof/shared";
import type { ResolvedVerdict } from "./compute";

export interface RawVerdict {
  id: string;
  verdict: Verdict;
  quotes: string[];
}

export const UNVERIFIED_FLAG = "The AI cited text that is not in the CV";

const MAX_QUOTES = 2;
const MAX_QUOTE_CHARS = 300;

// The model's verdicts count only as far as its quotes can be found in the CV
// text that was sent to it. A MET or PARTIAL with no such quote becomes
// NOT_FOUND, so no points are ever awarded on an invented quote.
export function verifyEvidence(
  criteria: { id: string }[],
  result: RawVerdict[],
  redactedText: string,
): ResolvedVerdict[] {
  const byId = new Map(result.map((r) => [r.id, r]));
  return criteria.map(({ id }) => {
    const raw = byId.get(id);
    if (!raw || raw.verdict === "NOT_FOUND") {
      return { id, verdict: "NOT_FOUND", quotes: [], flag: null };
    }
    const quotes = raw.quotes
      .map((q) => q.trim().slice(0, MAX_QUOTE_CHARS))
      .filter(Boolean)
      .slice(0, MAX_QUOTES)
      .map((text) => ({
        text,
        verified: findQuote(redactedText, text) !== null,
      }));
    if (!quotes.some((q) => q.verified)) {
      return { id, verdict: "NOT_FOUND", quotes, flag: UNVERIFIED_FLAG };
    }
    return { id, verdict: raw.verdict, quotes, flag: null };
  });
}
