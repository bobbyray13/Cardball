ALTER TABLE "games" ADD COLUMN "draft_id" integer;--> statement-breakpoint
ALTER TABLE "user_cards" ADD COLUMN "sandbox" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_draft_id_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."drafts"("id") ON DELETE set null ON UPDATE no action;