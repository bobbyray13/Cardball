CREATE TABLE "user_packs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"theme_id" text DEFAULT 'mixed' NOT NULL,
	"shape" text DEFAULT 'random' NOT NULL,
	"size" integer DEFAULT 5 NOT NULL,
	"year_from" integer DEFAULT 1993 NOT NULL,
	"year_to" integer DEFAULT 2026 NOT NULL,
	"source" text DEFAULT 'grant' NOT NULL,
	"label" text,
	"reward_key" text,
	"opened_at" timestamp,
	"drawn" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_packs" ADD CONSTRAINT "user_packs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_packs_reward_idx" ON "user_packs" USING btree ("user_id","reward_key");--> statement-breakpoint
CREATE INDEX "user_packs_user_idx" ON "user_packs" USING btree ("user_id","opened_at");