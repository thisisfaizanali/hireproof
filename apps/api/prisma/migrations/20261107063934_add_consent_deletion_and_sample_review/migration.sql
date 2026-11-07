-- CreateEnum
CREATE TYPE "ConsentBasis" AS ENUM ('APPLIED_OR_AGREED');

-- CreateEnum
CREATE TYPE "ConsentSource" AS ENUM ('JOB_PORTAL', 'REFERRAL', 'DIRECT_APPLICATION', 'AGENCY_DATABASE', 'OTHER');

-- CreateEnum
CREATE TYPE "DeletionReason" AS ENUM ('CANDIDATE_REQUEST', 'RETENTION_ENDED', 'UPLOADED_BY_MISTAKE');

-- CreateEnum
CREATE TYPE "SampleVerdict" AS ENUM ('AI_RIGHT', 'RECRUITER_RIGHT', 'BOTH_REASONABLE');

-- AlterTable
ALTER TABLE "Candidate" ADD COLUMN     "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ALTER COLUMN "code" SET DEFAULT 'CND-' || lpad(nextval('candidate_code_seq')::text, 5, '0');

-- AlterTable
ALTER TABLE "UploadBatch" ADD COLUMN     "consentAt" TIMESTAMP(3),
ADD COLUMN     "consentSource" "ConsentSource",
ADD COLUMN     "consentSourceNote" TEXT;

-- CreateTable
CREATE TABLE "ConsentRecord" (
    "id" TEXT NOT NULL,
    "cvId" TEXT NOT NULL,
    "candidateId" TEXT,
    "basis" "ConsentBasis" NOT NULL,
    "source" "ConsentSource" NOT NULL,
    "sourceNote" TEXT,
    "attestedById" TEXT NOT NULL,
    "attestedAt" TIMESTAMP(3) NOT NULL,
    "noticeVersion" TEXT NOT NULL,

    CONSTRAINT "ConsentRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeletionRecord" (
    "id" TEXT NOT NULL,
    "candidateCode" TEXT NOT NULL,
    "reason" "DeletionReason" NOT NULL,
    "deletedById" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "counts" JSONB NOT NULL,

    CONSTRAINT "DeletionRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SampleReview" (
    "id" TEXT NOT NULL,
    "weekStart" DATE NOT NULL,
    "applicationId" TEXT,
    "verdict" "SampleVerdict" NOT NULL,
    "note" TEXT,
    "reviewedById" TEXT NOT NULL,
    "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "band" "ScoreBand",
    "decision" TEXT NOT NULL,
    "requisitionNumber" INTEGER NOT NULL,

    CONSTRAINT "SampleReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ConsentRecord_cvId_key" ON "ConsentRecord"("cvId");

-- CreateIndex
CREATE INDEX "ConsentRecord_candidateId_idx" ON "ConsentRecord"("candidateId");

-- CreateIndex
CREATE INDEX "DeletionRecord_deletedAt_idx" ON "DeletionRecord"("deletedAt");

-- CreateIndex
CREATE INDEX "SampleReview_weekStart_idx" ON "SampleReview"("weekStart");

-- CreateIndex
CREATE UNIQUE INDEX "SampleReview_weekStart_applicationId_key" ON "SampleReview"("weekStart", "applicationId");

-- CreateIndex
CREATE INDEX "AuditEvent_action_createdAt_idx" ON "AuditEvent"("action", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_actorId_createdAt_idx" ON "AuditEvent"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "Candidate_lastActivityAt_idx" ON "Candidate"("lastActivityAt");

-- AddForeignKey
ALTER TABLE "ConsentRecord" ADD CONSTRAINT "ConsentRecord_cvId_fkey" FOREIGN KEY ("cvId") REFERENCES "CvDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentRecord" ADD CONSTRAINT "ConsentRecord_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentRecord" ADD CONSTRAINT "ConsentRecord_attestedById_fkey" FOREIGN KEY ("attestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeletionRecord" ADD CONSTRAINT "DeletionRecord_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SampleReview" ADD CONSTRAINT "SampleReview_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SampleReview" ADD CONSTRAINT "SampleReview_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
