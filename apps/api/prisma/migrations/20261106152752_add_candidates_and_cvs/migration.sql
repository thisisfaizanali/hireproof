-- Human-readable candidate codes: CND- plus five digits.
CREATE SEQUENCE candidate_code_seq START 10001;

-- CreateEnum
CREATE TYPE "TextSource" AS ENUM ('TEXT_LAYER', 'OCR');

-- CreateEnum
CREATE TYPE "CvStatus" AS ENUM ('QUEUED', 'EXTRACTING', 'OCR', 'PARSING', 'PARSED', 'NEEDS_REVIEW', 'FAILED', 'DUPLICATE_FILE');

-- CreateEnum
CREATE TYPE "ParseSource" AS ENUM ('AI', 'RULES');

-- CreateEnum
CREATE TYPE "ApplicationStage" AS ENUM ('SOURCED', 'SCREENED', 'SUBMITTED', 'CLIENT_SHORTLISTED', 'INTERVIEW', 'OFFERED', 'JOINED', 'REJECTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "DuplicateKind" AS ENUM ('EXACT_FILE', 'CONTACT', 'FUZZY');

-- CreateEnum
CREATE TYPE "DuplicateStatus" AS ENUM ('AUTO_MERGED', 'PENDING', 'SAME_PERSON', 'DIFFERENT_PEOPLE');

-- CreateTable
CREATE TABLE "Candidate" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL DEFAULT 'CND-' || lpad(nextval('candidate_code_seq')::text, 5, '0'),
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "location" TEXT,
    "currentRole" TEXT,
    "totalExperienceYears" DECIMAL(4,1),
    "skills" TEXT[],
    "noticeText" TEXT,
    "noticeDays" INTEGER,
    "ctcText" TEXT,
    "currentCtcLpa" DECIMAL(6,2),
    "expectedCtcLpa" DECIMAL(6,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Candidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UploadBatch" (
    "id" TEXT NOT NULL,
    "requisitionId" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "expectedCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UploadBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CvDocument" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT,
    "batchId" TEXT NOT NULL,
    "requisitionId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "text" TEXT,
    "redactedText" TEXT,
    "textSource" "TextSource",
    "ocrConfidence" DOUBLE PRECISION,
    "status" "CvStatus" NOT NULL DEFAULT 'QUEUED',
    "reviewReasons" TEXT[],
    "failureReason" TEXT,
    "parseSource" "ParseSource",
    "profile" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CvDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Application" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "requisitionId" TEXT NOT NULL,
    "stage" "ApplicationStage" NOT NULL DEFAULT 'SOURCED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Application_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DuplicateLink" (
    "id" TEXT NOT NULL,
    "cvId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "kind" "DuplicateKind" NOT NULL,
    "similarity" DOUBLE PRECISION,
    "status" "DuplicateStatus" NOT NULL,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DuplicateLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Candidate_code_key" ON "Candidate"("code");

-- CreateIndex
CREATE INDEX "Candidate_email_idx" ON "Candidate"("email");

-- CreateIndex
CREATE INDEX "Candidate_phone_idx" ON "Candidate"("phone");

-- CreateIndex
CREATE INDEX "UploadBatch_requisitionId_createdAt_idx" ON "UploadBatch"("requisitionId", "createdAt");

-- CreateIndex
CREATE INDEX "CvDocument_sha256_idx" ON "CvDocument"("sha256");

-- CreateIndex
CREATE INDEX "CvDocument_batchId_idx" ON "CvDocument"("batchId");

-- CreateIndex
CREATE INDEX "CvDocument_candidateId_idx" ON "CvDocument"("candidateId");

-- CreateIndex
CREATE INDEX "CvDocument_requisitionId_idx" ON "CvDocument"("requisitionId");

-- CreateIndex
CREATE INDEX "Application_requisitionId_createdAt_idx" ON "Application"("requisitionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Application_candidateId_requisitionId_key" ON "Application"("candidateId", "requisitionId");

-- CreateIndex
CREATE INDEX "DuplicateLink_status_idx" ON "DuplicateLink"("status");

-- CreateIndex
CREATE INDEX "DuplicateLink_cvId_idx" ON "DuplicateLink"("cvId");

-- CreateIndex
CREATE INDEX "DuplicateLink_candidateId_idx" ON "DuplicateLink"("candidateId");

-- AddForeignKey
ALTER TABLE "UploadBatch" ADD CONSTRAINT "UploadBatch_requisitionId_fkey" FOREIGN KEY ("requisitionId") REFERENCES "Requisition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UploadBatch" ADD CONSTRAINT "UploadBatch_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CvDocument" ADD CONSTRAINT "CvDocument_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CvDocument" ADD CONSTRAINT "CvDocument_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "UploadBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CvDocument" ADD CONSTRAINT "CvDocument_requisitionId_fkey" FOREIGN KEY ("requisitionId") REFERENCES "Requisition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_requisitionId_fkey" FOREIGN KEY ("requisitionId") REFERENCES "Requisition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DuplicateLink" ADD CONSTRAINT "DuplicateLink_cvId_fkey" FOREIGN KEY ("cvId") REFERENCES "CvDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DuplicateLink" ADD CONSTRAINT "DuplicateLink_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DuplicateLink" ADD CONSTRAINT "DuplicateLink_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
