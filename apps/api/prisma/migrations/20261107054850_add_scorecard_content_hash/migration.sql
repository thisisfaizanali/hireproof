-- AlterTable
ALTER TABLE "Candidate" ALTER COLUMN "code" SET DEFAULT 'CND-' || lpad(nextval('candidate_code_seq')::text, 5, '0');

-- AlterTable
ALTER TABLE "Scorecard" ADD COLUMN     "contentHash" TEXT;
