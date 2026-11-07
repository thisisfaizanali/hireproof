import type { DeletionCounts, DeletionReason } from "@hireproof/shared";
import { audit } from "./audit";
import { lockCandidates } from "./cv/job";
import { prisma } from "./db";

// Removes a candidate and everything held about them in one transaction. What
// stays is a record of the code, the reason and the counts, which carries no
// personal data. Queued jobs hold only ids; they find nothing and stop.
export async function eraseCandidate(input: {
  candidateId: string;
  reason: DeletionReason;
  actorId: string;
  ip?: string;
}): Promise<DeletionCounts | null> {
  const { candidateId, reason, actorId, ip } = input;
  return prisma.$transaction(async (tx) => {
    // The same lock the CV job takes before it decides on a candidate.
    await lockCandidates(tx);
    const candidate = await tx.candidate.findUnique({
      where: { id: candidateId },
      select: {
        code: true,
        cvs: { select: { id: true } },
        applications: { select: { id: true } },
      },
    });
    if (!candidate) return null;
    const cvIds = candidate.cvs.map((cv) => cv.id);
    const applicationIds = candidate.applications.map((a) => a.id);
    const ofApplications = { applicationId: { in: applicationIds } };

    // A note typed in a weekly review may name the person.
    await tx.sampleReview.updateMany({
      where: ofApplications,
      data: { note: null },
    });
    const messages = await tx.outboundMessage.deleteMany({
      where: ofApplications,
    });
    const slots = await tx.interviewSlot.deleteMany({ where: ofApplications });
    const scores = await tx.candidateScore.deleteMany({
      where: ofApplications,
    });
    const consentRecords = await tx.consentRecord.deleteMany({
      where: { OR: [{ candidateId }, { cvId: { in: cvIds } }] },
    });
    const duplicateLinks = await tx.duplicateLink.deleteMany({
      where: { OR: [{ candidateId }, { cvId: { in: cvIds } }] },
    });
    const applications = await tx.application.deleteMany({
      where: { candidateId },
    });
    const cvs = await tx.cvDocument.deleteMany({ where: { candidateId } });
    await tx.candidate.delete({ where: { id: candidateId } });

    const counts: DeletionCounts = {
      cvs: cvs.count,
      applications: applications.count,
      scores: scores.count,
      slots: slots.count,
      messages: messages.count,
      consentRecords: consentRecords.count,
      duplicateLinks: duplicateLinks.count,
    };
    await tx.deletionRecord.create({
      data: {
        candidateCode: candidate.code,
        reason,
        deletedById: actorId,
        counts,
      },
    });
    await audit(
      {
        action: "CANDIDATE_DELETED",
        actorId,
        entityType: "Candidate",
        entityId: candidateId,
        meta: { code: candidate.code, reason, ...counts },
        ip,
      },
      tx,
    );
    return counts;
  });
}
