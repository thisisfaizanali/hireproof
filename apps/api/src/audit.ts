import type { Prisma, PrismaClient } from "./generated/prisma/client";
import { prisma } from "./db";

interface AuditInput {
  action: string;
  actorId?: string;
  entityType?: string;
  entityId?: string;
  // Ids, codes, stages, bands, reasons and counts. Never a name, email,
  // phone number or any CV text.
  meta?: Prisma.InputJsonValue;
  ip?: string;
}

export function audit(
  event: AuditInput,
  db: Pick<PrismaClient, "auditEvent"> = prisma,
) {
  return db.auditEvent.create({ data: event });
}
