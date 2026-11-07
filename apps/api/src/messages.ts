import { formatIst, slotModeLabel } from "@hireproof/shared";
import { prisma } from "./db";
import type { MessageRecipient, SlotMode } from "./generated/prisma/client";

// Messaging is mocked in this demo: a row records what would be sent and
// nothing leaves the system.
export async function recordMessage(input: {
  applicationId: string;
  recipient: MessageRecipient;
  subject: string;
  body: string;
  createdById: string;
}) {
  return prisma.outboundMessage.create({ data: input });
}

export function interviewInvite(input: {
  candidateName: string;
  clientName: string;
  title: string;
  startsAt: Date;
  durationMinutes: number;
  mode: SlotMode;
  note: string | null;
  recruiterName: string;
}) {
  const first = input.candidateName.split(/\s+/)[0];
  return {
    subject: `Interview for ${input.title} at ${input.clientName}`,
    body: [
      `Hello ${first},`,
      "",
      `${input.clientName} would like to meet you for the ${input.title} role.`,
      "",
      `When: ${formatIst(input.startsAt.toISOString())}`,
      `Duration: ${input.durationMinutes} minutes`,
      `Format: ${slotModeLabel(input.mode)}`,
      ...(input.note ? [`Note: ${input.note}`] : []),
      "",
      "Please reply to confirm that you can attend.",
      "",
      input.recruiterName,
      "Hireproof",
    ].join("\n"),
  };
}

export function noTimesWork(input: {
  candidateName: string;
  title: string;
  recruiterName: string;
}) {
  return {
    subject: `Interview times for ${input.candidateName}`,
    body: [
      "Hello,",
      "",
      `${input.candidateName} cannot make any of the times you proposed for the ${input.title} role. Please propose a few other times in the portal.`,
      "",
      input.recruiterName,
      "Hireproof",
    ].join("\n"),
  };
}
