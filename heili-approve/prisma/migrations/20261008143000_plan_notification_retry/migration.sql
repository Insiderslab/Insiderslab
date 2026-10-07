-- Keep completion notifications recoverable when email delivery fails or a
-- process stops after claiming the work.
ALTER TABLE "ContentPlan"
ADD COLUMN "completedNotificationClaimedAt" TIMESTAMP(3),
ADD COLUMN "completedNotificationRetryAt" TIMESTAMP(3);

CREATE INDEX "ContentPlan_completion_notification_retry_idx"
ON "ContentPlan"("completedNotifiedAt", "completedNotificationRetryAt");
