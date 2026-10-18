-- CreateEnum
CREATE TYPE "ActivityKind" AS ENUM ('TASK', 'INFO');

-- CreateEnum
CREATE TYPE "ActivityStatus" AS ENUM ('OPEN', 'DONE');

-- CreateEnum
CREATE TYPE "ActivityType" AS ENUM ('CHANGES_REQUESTED', 'CLIENT_COMMENT', 'PLAN_COMMENT', 'WEBSITE_NOTES', 'SCHEDULE_FAILED', 'APPROVED', 'PLAN_APPROVED');

-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "ownerUserId" TEXT;

-- CreateTable
CREATE TABLE "AgencyActivity" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "postId" TEXT,
    "planId" TEXT,
    "type" "ActivityType" NOT NULL,
    "kind" "ActivityKind" NOT NULL,
    "status" "ActivityStatus" NOT NULL DEFAULT 'OPEN',
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "versionNumber" INTEGER,
    "assigneeUserId" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "doneAt" TIMESTAMP(3),
    "doneByUserId" TEXT,
    "readAt" TIMESTAMP(3),

    CONSTRAINT "AgencyActivity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgencyActivity_workspaceId_status_kind_createdAt_idx" ON "AgencyActivity"("workspaceId", "status", "kind", "createdAt");

-- CreateIndex
CREATE INDEX "AgencyActivity_assigneeUserId_status_idx" ON "AgencyActivity"("assigneeUserId", "status");

-- CreateIndex
CREATE INDEX "AgencyActivity_postId_idx" ON "AgencyActivity"("postId");

-- CreateIndex
CREATE UNIQUE INDEX "AgencyActivity_workspaceId_dedupeKey_key" ON "AgencyActivity"("workspaceId", "dedupeKey");

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgencyActivity" ADD CONSTRAINT "AgencyActivity_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgencyActivity" ADD CONSTRAINT "AgencyActivity_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgencyActivity" ADD CONSTRAINT "AgencyActivity_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgencyActivity" ADD CONSTRAINT "AgencyActivity_planId_fkey" FOREIGN KEY ("planId") REFERENCES "ContentPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgencyActivity" ADD CONSTRAINT "AgencyActivity_assigneeUserId_fkey" FOREIGN KEY ("assigneeUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
