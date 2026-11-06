-- CreateEnum
CREATE TYPE "RejectReason" AS ENUM ('SKILLS_GAP', 'EXPERIENCE', 'NOTICE_PERIOD', 'CTC', 'LOCATION', 'OTHER');

-- CreateEnum
CREATE TYPE "ScoreBand" AS ENUM ('STRONG', 'POSSIBLE', 'WEAK');

-- CreateEnum
CREATE TYPE "ScoreSource" AS ENUM ('AI', 'RULES');

-- AlterTable
ALTER TABLE "Application" ADD COLUMN     "decidedAt" TIMESTAMP(3),
ADD COLUMN     "decidedById" TEXT,
ADD COLUMN     "rejectNote" TEXT,
ADD COLUMN     "rejectReason" "RejectReason",
ADD COLUMN     "scoringStartedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Candidate" ALTER COLUMN "code" SET DEFAULT 'CND-' || lpad(nextval('candidate_code_seq')::text, 5, '0');

-- CreateTable
CREATE TABLE "CandidateScore" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "scorecardVersion" INTEGER NOT NULL,
    "total" INTEGER NOT NULL,
    "band" "ScoreBand" NOT NULL,
    "mustHavesMet" INTEGER NOT NULL,
    "mustHavesTotal" INTEGER NOT NULL,
    "experiencePoints" INTEGER NOT NULL,
    "criteria" JSONB NOT NULL,
    "flags" TEXT[],
    "source" "ScoreSource" NOT NULL,
    "model" TEXT,
    "stale" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CandidateScore_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CandidateScore_applicationId_idx" ON "CandidateScore"("applicationId");

-- CreateIndex
CREATE UNIQUE INDEX "CandidateScore_applicationId_scorecardVersion_key" ON "CandidateScore"("applicationId", "scorecardVersion");

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateScore" ADD CONSTRAINT "CandidateScore_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;
