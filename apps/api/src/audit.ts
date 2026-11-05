import type { Prisma } from "./generated/prisma/client";
import { prisma } from "./db";

interface AuditInput {
  action: string;
  actorId?: string;
  entityType?: string;
  entityId?: string;
  meta?: Prisma.InputJsonValue;
  ip?: string;
}

export function audit(event: AuditInput) {
  return prisma.auditEvent.create({ data: event });
}
