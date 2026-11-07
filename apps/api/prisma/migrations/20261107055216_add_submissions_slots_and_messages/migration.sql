-- CreateEnum
CREATE TYPE "RejectedBy" AS ENUM ('RECRUITER', 'CLIENT');

-- CreateEnum
CREATE TYPE "ClientRejectReason" AS ENUM ('SKILLS_GAP', 'EXPERIENCE', 'NOTICE_PERIOD', 'CTC', 'LOCATION', 'ALREADY_INTERVIEWED', 'OTHER');

-- CreateEnum
CREATE TYPE "SlotMode" AS ENUM ('VIDEO', 'IN_PERSON');

-- CreateEnum
CREATE TYPE "SlotStatus" AS ENUM ('PROPOSED', 'CONFIRMED', 'DECLINED');

-- CreateEnum
CREATE TYPE "MessageRecipient" AS ENUM ('CANDIDATE', 'CLIENT');

-- CreateEnum
CREATE TYPE "MessageChannel" AS ENUM ('EMAIL');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('MOCKED');

-- AlterTable
ALTER TABLE "Application" ADD COLUMN     "clientRejectNote" TEXT,
ADD COLUMN     "clientRejectReason" "ClientRejectReason",
ADD COLUMN     "rejectedBy" "RejectedBy",
ADD COLUMN     "submissionNote" TEXT,
ADD COLUMN     "submittedAt" TIMESTAMP(3),
ADD COLUMN     "submittedById" TEXT;

-- AlterTable
ALTER TABLE "Candidate" ALTER COLUMN "code" SET DEFAULT 'CND-' || lpad(nextval('candidate_code_seq')::text, 5, '0');

-- CreateTable
CREATE TABLE "InterviewSlot" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "mode" "SlotMode" NOT NULL,
    "note" TEXT,
    "status" "SlotStatus" NOT NULL DEFAULT 'PROPOSED',
    "proposedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InterviewSlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboundMessage" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "recipient" "MessageRecipient" NOT NULL,
    "channel" "MessageChannel" NOT NULL DEFAULT 'EMAIL',
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "MessageStatus" NOT NULL DEFAULT 'MOCKED',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutboundMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InterviewSlot_applicationId_idx" ON "InterviewSlot"("applicationId");

-- CreateIndex
CREATE INDEX "OutboundMessage_applicationId_idx" ON "OutboundMessage"("applicationId");

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterviewSlot" ADD CONSTRAINT "InterviewSlot_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterviewSlot" ADD CONSTRAINT "InterviewSlot_proposedById_fkey" FOREIGN KEY ("proposedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboundMessage" ADD CONSTRAINT "OutboundMessage_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboundMessage" ADD CONSTRAINT "OutboundMessage_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
