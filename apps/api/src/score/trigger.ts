import { prisma } from "../db";

export interface ScoreJob {
  applicationId: string;
  // Score again even when this scorecard version already has a score.
  force?: boolean;
}

type Sender = (job: ScoreJob) => Promise<unknown>;

// The queue registers itself here, so code that needs to start scoring does
// not import the queue (which imports the jobs). Without a queue (tests,
// scripts) nothing is sent and the application waits.
let sender: Sender | undefined;
export const setScoreSender = (next: Sender | undefined) => {
  sender = next;
};

export async function queueScoring(applicationIds: string[], force = false) {
  for (const applicationId of applicationIds) {
    await sender?.({ applicationId, force });
  }
}

export const SCORABLE = ["PARSED", "NEEDS_REVIEW"] as const;

// Applications whose candidate has a CV with text to score.
export async function scorableApplicationIds(where: {
  requisitionId?: string;
  candidateId?: string;
}) {
  const rows = await prisma.application.findMany({
    where: {
      ...where,
      candidate: {
        cvs: {
          some: { redactedText: { not: null }, status: { in: [...SCORABLE] } },
        },
      },
    },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

export async function queueRequisition(requisitionId: string, force = false) {
  await queueScoring(await scorableApplicationIds({ requisitionId }), force);
}

export async function queueCandidate(candidateId: string) {
  await queueScoring(await scorableApplicationIds({ candidateId }), true);
}
