import { prisma } from "./db";

// Retention runs from a candidate's last CV upload or stage change.
export const markActive = (applicationId: string) =>
  prisma.candidate.updateMany({
    where: { applications: { some: { id: applicationId } } },
    data: { lastActivityAt: new Date() },
  });
