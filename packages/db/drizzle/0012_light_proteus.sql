-- A tournament row can point at a draft room that was deleted directly (the
-- old column was a bare integer with no constraint). Clear the pointer first
-- so the foreign key can land.
UPDATE "tournaments" SET "draft_id" = NULL WHERE "draft_id" IS NOT NULL AND "draft_id" NOT IN (SELECT "id" FROM "drafts");
--> statement-breakpoint
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_draft_id_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."drafts"("id") ON DELETE set null ON UPDATE no action;
