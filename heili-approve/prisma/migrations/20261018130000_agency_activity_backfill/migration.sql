-- Backfill of «Attività»: the top-bar chip «N da gestire» used to count the
-- posts waiting on the agency (changes requested, scheduling failed) and now
-- counts open tasks. Without this, every such post that exists today would
-- vanish from the chip and from the task list the day the feature ships.
-- Additive only: it inserts rows, never touches existing ones, and is safe to
-- run twice (same dedupe keys as lib/notifications.ts).

-- Posts with changes requested → one open task each, excerpt from the client's
-- first open comment on the version.
INSERT INTO "AgencyActivity" (
    "id", "workspaceId", "clientId", "postId", "planId", "type", "kind", "status",
    "title", "summary", "versionNumber", "assigneeUserId", "dedupeKey", "createdAt", "updatedAt"
)
SELECT
    'bf' || md5('changes:' || p."id" || ':v' || p."currentVersionNumber"),
    p."workspaceId",
    p."clientId",
    p."id",
    p."planId",
    CASE WHEN p."kind" = 'WEBSITE' THEN 'WEBSITE_NOTES'::"ActivityType" ELSE 'CHANGES_REQUESTED'::"ActivityType" END,
    'TASK'::"ActivityKind",
    'OPEN'::"ActivityStatus",
    CASE WHEN p."kind" = 'WEBSITE' THEN 'Note sul sito: ' ELSE 'Modifiche richieste: ' END || p."title",
    COALESCE(
        (
            SELECT left(btrim(regexp_replace(regexp_replace(c."body", '\[[^\]]*\]', ' ', 'g'), '\s+', ' ', 'g')), 500)
            FROM "PostComment" c
            WHERE c."postId" = p."id" AND c."authorType" = 'CLIENT' AND c."resolvedAt" IS NULL
            ORDER BY c."createdAt" ASC
            LIMIT 1
        ),
        ''
    ),
    p."currentVersionNumber",
    cl."ownerUserId",
    'changes:' || p."id" || ':v' || p."currentVersionNumber",
    p."updatedAt",
    CURRENT_TIMESTAMP
FROM "Post" p
JOIN "Client" cl ON cl."id" = p."clientId"
WHERE p."status" = 'CHANGES_REQUESTED'
ON CONFLICT ("workspaceId", "dedupeKey") DO NOTHING;

-- Posts whose scheduling failed → one open task each.
INSERT INTO "AgencyActivity" (
    "id", "workspaceId", "clientId", "postId", "planId", "type", "kind", "status",
    "title", "summary", "versionNumber", "assigneeUserId", "dedupeKey", "createdAt", "updatedAt"
)
SELECT
    'bf' || md5('schedule-failed:' || p."id" || ':v' || p."currentVersionNumber"),
    p."workspaceId",
    p."clientId",
    p."id",
    p."planId",
    'SCHEDULE_FAILED'::"ActivityType",
    'TASK'::"ActivityKind",
    'OPEN'::"ActivityStatus",
    'Programmazione non riuscita: ' || p."title",
    left(btrim(regexp_replace(COALESCE(p."lastError", ''), '\s+', ' ', 'g')), 500),
    p."currentVersionNumber",
    cl."ownerUserId",
    'schedule-failed:' || p."id" || ':v' || p."currentVersionNumber",
    p."updatedAt",
    CURRENT_TIMESTAMP
FROM "Post" p
JOIN "Client" cl ON cl."id" = p."clientId"
WHERE p."status" = 'FAILED'
ON CONFLICT ("workspaceId", "dedupeKey") DO NOTHING;
