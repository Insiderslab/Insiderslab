-- Piano del mese (ContentPlan): i post social di un cliente per un mese,
-- presentati e rivisti insieme. Post.planId è facoltativo (SET NULL).

-- CreateEnum
CREATE TYPE "PlanStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'CHANGES_REQUESTED', 'APPROVED');

-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "planId" TEXT;

-- CreateTable
CREATE TABLE "ContentPlan" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "kind" "ContentKind" NOT NULL DEFAULT 'SOCIAL_POST',
    "month" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "intro" TEXT,
    "status" "PlanStatus" NOT NULL DEFAULT 'DRAFT',
    "sentAt" TIMESTAMP(3),
    "reviewDueAt" TIMESTAMP(3),
    "completedNotifiedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentPlanComment" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "authorType" "CommentAuthorType" NOT NULL,
    "reviewerId" TEXT,
    "userId" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentPlanComment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContentPlan_workspaceId_month_idx" ON "ContentPlan"("workspaceId", "month");

-- CreateIndex
CREATE UNIQUE INDEX "ContentPlan_clientId_kind_month_key" ON "ContentPlan"("clientId", "kind", "month");

-- CreateIndex
CREATE INDEX "ContentPlanComment_planId_createdAt_idx" ON "ContentPlanComment"("planId", "createdAt");

-- CreateIndex
CREATE INDEX "Post_planId_idx" ON "Post"("planId");

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_planId_fkey" FOREIGN KEY ("planId") REFERENCES "ContentPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentPlan" ADD CONSTRAINT "ContentPlan_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentPlan" ADD CONSTRAINT "ContentPlan_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentPlan" ADD CONSTRAINT "ContentPlan_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentPlanComment" ADD CONSTRAINT "ContentPlanComment_planId_fkey" FOREIGN KEY ("planId") REFERENCES "ContentPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentPlanComment" ADD CONSTRAINT "ContentPlanComment_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "ClientReviewer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentPlanComment" ADD CONSTRAINT "ContentPlanComment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
