ALTER TABLE "Client" ADD COLUMN "reviewReminderClaimedAt" TIMESTAMP(3);
ALTER TABLE "Post" ADD COLUMN "importKey" TEXT, ADD COLUMN "importHash" TEXT;
CREATE UNIQUE INDEX "Post_workspaceId_importKey_key" ON "Post"("workspaceId", "importKey");

CREATE TABLE "ReviewProviderAttempt" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReviewProviderAttempt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ReviewProviderAttempt_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ReviewSession"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ReviewProviderAttempt_sessionId_createdAt_idx" ON "ReviewProviderAttempt"("sessionId", "createdAt");
CREATE INDEX "ReviewProviderAttempt_createdAt_idx" ON "ReviewProviderAttempt"("createdAt");

CREATE TABLE "AutomationToken" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  CONSTRAINT "AutomationToken_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AutomationToken_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AutomationToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AutomationToken_tokenHash_key" ON "AutomationToken"("tokenHash");
CREATE INDEX "AutomationToken_workspaceId_userId_idx" ON "AutomationToken"("workspaceId", "userId");

CREATE TABLE "AutomationUploadReservation" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AutomationUploadReservation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AutomationUploadReservation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "AutomationUploadReservation_workspaceId_expiresAt_idx" ON "AutomationUploadReservation"("workspaceId", "expiresAt");
