-- CreateEnum
CREATE TYPE "RequisitionStatus" AS ENUM ('DRAFT', 'OPEN', 'ON_HOLD', 'CLOSED');

-- CreateEnum
CREATE TYPE "ScorecardSource" AS ENUM ('AI', 'RULES', 'MANUAL');

-- CreateEnum
CREATE TYPE "ScorecardStatus" AS ENUM ('DRAFT', 'CONFIRMED');

-- CreateEnum
CREATE TYPE "CriterionKind" AS ENUM ('MUST_HAVE', 'NICE_TO_HAVE');

-- CreateEnum
CREATE TYPE "AiOutcome" AS ENUM ('OK', 'RETRIED_OK', 'INVALID_OUTPUT', 'PROVIDER_ERROR', 'NOT_CONFIGURED');

-- CreateTable
CREATE TABLE "Requisition" (
    "id" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    "clientId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "jdText" TEXT NOT NULL,
    "jdFileName" TEXT,
    "status" "RequisitionStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Requisition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Scorecard" (
    "id" TEXT NOT NULL,
    "requisitionId" TEXT NOT NULL,
    "experienceMinYears" DOUBLE PRECISION,
    "experienceMaxYears" DOUBLE PRECISION,
    "experienceQuote" TEXT,
    "experienceReview" BOOLEAN NOT NULL DEFAULT false,
    "noticeMaxDays" INTEGER,
    "noticeQuote" TEXT,
    "noticeReview" BOOLEAN NOT NULL DEFAULT false,
    "ctcMaxLpa" DOUBLE PRECISION,
    "ctcQuote" TEXT,
    "ctcReview" BOOLEAN NOT NULL DEFAULT false,
    "locations" TEXT[],
    "locationsQuote" TEXT,
    "locationsReview" BOOLEAN NOT NULL DEFAULT false,
    "ambiguities" TEXT[],
    "source" "ScorecardSource" NOT NULL,
    "model" TEXT,
    "status" "ScorecardStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 0,
    "confirmedAt" TIMESTAMP(3),
    "confirmedById" TEXT,

    CONSTRAINT "Scorecard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Criterion" (
    "id" TEXT NOT NULL,
    "scorecardId" TEXT NOT NULL,
    "kind" "CriterionKind" NOT NULL,
    "label" TEXT NOT NULL,
    "sourceQuote" TEXT,
    "needsReview" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL,

    CONSTRAINT "Criterion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiRun" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "requisitionId" TEXT,
    "model" TEXT NOT NULL,
    "outcome" "AiOutcome" NOT NULL,
    "latencyMs" INTEGER NOT NULL,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Requisition_number_key" ON "Requisition"("number");

-- CreateIndex
CREATE INDEX "Requisition_clientId_idx" ON "Requisition"("clientId");

-- CreateIndex
CREATE INDEX "Requisition_status_idx" ON "Requisition"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Scorecard_requisitionId_key" ON "Scorecard"("requisitionId");

-- CreateIndex
CREATE INDEX "Criterion_scorecardId_idx" ON "Criterion"("scorecardId");

-- CreateIndex
CREATE INDEX "AiRun_requisitionId_idx" ON "AiRun"("requisitionId");

-- AddForeignKey
ALTER TABLE "Requisition" ADD CONSTRAINT "Requisition_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Requisition" ADD CONSTRAINT "Requisition_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scorecard" ADD CONSTRAINT "Scorecard_requisitionId_fkey" FOREIGN KEY ("requisitionId") REFERENCES "Requisition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scorecard" ADD CONSTRAINT "Scorecard_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Criterion" ADD CONSTRAINT "Criterion_scorecardId_fkey" FOREIGN KEY ("scorecardId") REFERENCES "Scorecard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiRun" ADD CONSTRAINT "AiRun_requisitionId_fkey" FOREIGN KEY ("requisitionId") REFERENCES "Requisition"("id") ON DELETE SET NULL ON UPDATE CASCADE;
