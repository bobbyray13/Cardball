ALTER TABLE "drafts" ADD COLUMN "version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tournaments" ADD COLUMN "draft_id" integer;--> statement-breakpoint
-- Backfill the new column from the JSONB state it was always kept in. If two
-- rows ever claimed the same draft, the lowest id wins and the rest stay NULL,
-- so the unique index below can be created on existing data.
UPDATE "tournaments" AS t
SET "draft_id" = NULLIF(t."state"->>'draftId', '')::int
WHERE NULLIF(t."state"->>'draftId', '') IS NOT NULL
  AND t."id" = (
    SELECT MIN(t2."id") FROM "tournaments" AS t2
    WHERE NULLIF(t2."state"->>'draftId', '') IS NOT NULL
      AND t2."state"->>'draftId' = t."state"->>'draftId'
  );--> statement-breakpoint
CREATE INDEX "drafts_updated_idx" ON "drafts" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "games_updated_idx" ON "games" USING btree ("updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tournaments_draft_idx" ON "tournaments" USING btree ("draft_id");--> statement-breakpoint
CREATE INDEX "tournaments_updated_idx" ON "tournaments" USING btree ("updated_at");