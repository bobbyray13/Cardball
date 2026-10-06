CREATE TABLE "card_game_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"game_id" integer,
	"user_card_id" integer NOT NULL,
	"team_name" text NOT NULL,
	"opponent_name" text NOT NULL,
	"won" boolean NOT NULL,
	"batting" jsonb,
	"pitching" jsonb,
	"played_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "game_viewers" (
	"game_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "password_hash" text;--> statement-breakpoint
ALTER TABLE "card_game_lines" ADD CONSTRAINT "card_game_lines_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_game_lines" ADD CONSTRAINT "card_game_lines_user_card_id_user_cards_id_fk" FOREIGN KEY ("user_card_id") REFERENCES "public"."user_cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_viewers" ADD CONSTRAINT "game_viewers_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_viewers" ADD CONSTRAINT "game_viewers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "card_game_lines_game_card_idx" ON "card_game_lines" USING btree ("game_id","user_card_id");--> statement-breakpoint
CREATE INDEX "card_game_lines_card_idx" ON "card_game_lines" USING btree ("user_card_id");--> statement-breakpoint
CREATE UNIQUE INDEX "game_viewers_idx" ON "game_viewers" USING btree ("game_id","user_id");