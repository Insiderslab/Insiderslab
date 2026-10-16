-- Website review («Sito web», docs/SITO-WEB.md, Fase 1): a new content kind.
-- Additive only. The value is not used in this migration, so ADD VALUE is
-- safe inside the migration transaction (PostgreSQL 12+).
-- Snapshot captures (WebsiteCapture, capture-worker) are postponed: the
-- version content keeps room for them (mode, devices, page captures).

-- AlterEnum
ALTER TYPE "ContentKind" ADD VALUE 'WEBSITE';
