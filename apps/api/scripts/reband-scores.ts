import type { CriterionScore } from "@hireproof/shared";
import { prisma } from "../src/db";
import { bandFor } from "../src/score/compute";

// Applies the current band rule to stored scores from their stored total and
// criteria. No model is called and no total changes.
async function main() {
  const scores = await prisma.candidateScore.findMany({
    select: { id: true, total: true, band: true, criteria: true },
  });
  let changed = 0;
  for (const s of scores) {
    const band = bandFor(s.total, s.criteria as unknown as CriterionScore[]);
    if (band === s.band) continue;
    await prisma.candidateScore.update({ where: { id: s.id }, data: { band } });
    changed++;
  }
  console.log(`${changed} of ${scores.length} stored bands updated.`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
