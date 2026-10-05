-- Date, networks and per-network options are reviewed by the client together
-- with the content: each version keeps the ones it was sent with.
ALTER TABLE "PostVersion" ADD COLUMN "schedule" JSONB;

-- Existing versions: the post's current values are the best record there is.
UPDATE "PostVersion" AS v
SET "schedule" = jsonb_build_object(
  'publishAt', to_char(p."publishAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'networks', to_jsonb(p."networks"),
  'networkOptions', p."networkOptions"
)
FROM "Post" AS p
WHERE v."postId" = p."id";

-- Review assistant: one model call at a time per conversation.
ALTER TABLE "ReviewSession" ADD COLUMN "turnStartedAt" TIMESTAMP(3);
