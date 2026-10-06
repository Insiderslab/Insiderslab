-- CreateEnum
CREATE TYPE "ContentKind" AS ENUM ('SOCIAL_POST', 'BLOG_ARTICLE', 'AD_CREATIVE');

-- CreateEnum
CREATE TYPE "CreativeVerdict" AS ENUM ('APPROVED', 'REJECTED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PostEventType" ADD VALUE 'DELIVERED';
ALTER TYPE "PostEventType" ADD VALUE 'VARIANT_DECIDED';

-- AlterEnum
ALTER TYPE "PostStatus" ADD VALUE 'DELIVERED';

-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "kind" "ContentKind" NOT NULL DEFAULT 'SOCIAL_POST';

-- AlterTable
ALTER TABLE "PostComment" ADD COLUMN     "anchor" JSONB,
ADD COLUMN     "variantId" TEXT;

-- AlterTable
ALTER TABLE "PostVersion" ADD COLUMN     "content" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "CreativeDecision" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "variantId" TEXT NOT NULL,
    "reviewerId" TEXT,
    "verdict" "CreativeVerdict" NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreativeDecision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CreativeDecision_postId_idx" ON "CreativeDecision"("postId");

-- CreateIndex
CREATE UNIQUE INDEX "CreativeDecision_postId_versionNumber_variantId_key" ON "CreativeDecision"("postId", "versionNumber", "variantId");

-- CreateIndex
CREATE INDEX "Post_workspaceId_kind_status_idx" ON "Post"("workspaceId", "kind", "status");

-- AddForeignKey
ALTER TABLE "CreativeDecision" ADD CONSTRAINT "CreativeDecision_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreativeDecision" ADD CONSTRAINT "CreativeDecision_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "ClientReviewer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
