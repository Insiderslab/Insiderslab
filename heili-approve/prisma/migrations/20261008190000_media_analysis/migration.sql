CREATE TABLE "MediaAnalysis" (
  "assetId" TEXT NOT NULL PRIMARY KEY,
  "revision" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "result" JSONB,
  "failureCode" TEXT,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MediaAnalysis_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "MediaAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "MediaAnalysis_status_createdAt_idx" ON "MediaAnalysis"("status", "createdAt");
CREATE TABLE "MediaAnalysisAttempt" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "workspaceId" TEXT NOT NULL,
  "assetId" TEXT NOT NULL,
  "audioSeconds" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MediaAnalysisAttempt_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "MediaAnalysisAttempt_workspaceId_createdAt_idx" ON "MediaAnalysisAttempt"("workspaceId", "createdAt");
