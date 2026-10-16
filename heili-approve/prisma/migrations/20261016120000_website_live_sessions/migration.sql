-- Website review «Sul sito» (docs/SITO-WEB.md, Fase 2): registered sites and
-- one-time launch codes / sessions. Additive only.
-- CreateEnum
CREATE TYPE "WebsiteSessionRole" AS ENUM ('REVIEWER', 'AGENCY');

-- CreateTable
CREATE TABLE "WebsiteSite" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "siteKey" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "origins" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "testOrigins" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "verifiedAt" TIMESTAMP(3),
    "verifyMessage" TEXT,
    "verifyWaivedAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebsiteSite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebsiteSession" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "role" "WebsiteSessionRole" NOT NULL,
    "reviewerId" TEXT,
    "userId" TEXT,
    "focusCommentId" TEXT,
    "launchHash" TEXT NOT NULL,
    "launchExpiresAt" TIMESTAMP(3) NOT NULL,
    "launchUsedAt" TIMESTAMP(3),
    "sessionHash" TEXT,
    "origin" TEXT,
    "expiresAt" TIMESTAMP(3),
    "absoluteExpiresAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebsiteSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WebsiteSite_siteKey_key" ON "WebsiteSite"("siteKey");

-- CreateIndex
CREATE INDEX "WebsiteSite_workspaceId_clientId_idx" ON "WebsiteSite"("workspaceId", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "WebsiteSession_launchHash_key" ON "WebsiteSession"("launchHash");

-- CreateIndex
CREATE UNIQUE INDEX "WebsiteSession_sessionHash_key" ON "WebsiteSession"("sessionHash");

-- CreateIndex
CREATE INDEX "WebsiteSession_postId_idx" ON "WebsiteSession"("postId");

-- CreateIndex
CREATE INDEX "WebsiteSession_launchExpiresAt_idx" ON "WebsiteSession"("launchExpiresAt");

-- AddForeignKey
ALTER TABLE "WebsiteSite" ADD CONSTRAINT "WebsiteSite_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebsiteSite" ADD CONSTRAINT "WebsiteSite_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebsiteSession" ADD CONSTRAINT "WebsiteSession_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "WebsiteSite"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebsiteSession" ADD CONSTRAINT "WebsiteSession_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;
