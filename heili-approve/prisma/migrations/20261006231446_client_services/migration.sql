-- Per-client services: which content kinds the agency prepares for each
-- client (social posts, blog articles, ads creatives).

-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "services" "ContentKind"[] DEFAULT ARRAY['SOCIAL_POST']::"ContentKind"[];

-- Backfill existing clients (same rule as inferClientServices in lib/clients.ts):
-- the kinds they already have content of, plus SOCIAL_POST when they have
-- social networks or a Metricool brand; never empty (SOCIAL_POST).
UPDATE "Client" AS c
SET "services" = COALESCE(
  (
    SELECT array_agg(s.kind ORDER BY s.kind)
    FROM (
      SELECT p."kind" AS kind FROM "Post" AS p WHERE p."clientId" = c."id"
      UNION
      SELECT 'SOCIAL_POST'::"ContentKind"
      WHERE cardinality(COALESCE(c."networks", ARRAY[]::TEXT[])) > 0 OR c."metricoolBlogId" IS NOT NULL
    ) AS s
  ),
  ARRAY['SOCIAL_POST']::"ContentKind"[]
);
