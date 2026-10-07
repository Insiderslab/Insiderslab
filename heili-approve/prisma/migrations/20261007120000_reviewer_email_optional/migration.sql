-- Reviewers without email: the agency shares the personal link by hand
-- (WhatsApp, message…). The unique (clientId, email) index stays: Postgres
-- treats NULLs as distinct, so many reviewers without email are allowed.

-- AlterTable
ALTER TABLE "ClientReviewer" ALTER COLUMN "email" DROP NOT NULL;
