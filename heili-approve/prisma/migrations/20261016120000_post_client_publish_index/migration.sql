-- The client portal lists a client's posts by publish date (open ones, then the
-- most recent decided ones, a plan, a month): an index on (clientId, publishAt)
-- keeps it an index range scan when a client has years of history.
CREATE INDEX "Post_clientId_publishAt_idx" ON "Post"("clientId", "publishAt");
