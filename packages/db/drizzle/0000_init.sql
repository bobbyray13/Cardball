CREATE TABLE "card_models" (
	"id" serial PRIMARY KEY NOT NULL,
	"person_id" integer NOT NULL,
	"card_year" integer NOT NULL,
	"set_label" text DEFAULT '' NOT NULL,
	"rarity" text,
	"source" text DEFAULT 'database' NOT NULL,
	"created_by_user_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"game_id" integer NOT NULL,
	"user_id" integer,
	"body" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "draft_participants" (
	"id" serial PRIMARY KEY NOT NULL,
	"draft_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"seat" integer NOT NULL,
	"joined_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drafts" (
	"id" serial PRIMARY KEY NOT NULL,
	"host_user_id" integer NOT NULL,
	"status" text DEFAULT 'lobby' NOT NULL,
	"config" jsonb NOT NULL,
	"state" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "game_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"game_id" integer NOT NULL,
	"seq" integer NOT NULL,
	"inning" integer NOT NULL,
	"half" text NOT NULL,
	"kind" text NOT NULL,
	"text" text NOT NULL,
	"data" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "games" (
	"id" serial PRIMARY KEY NOT NULL,
	"mode" text DEFAULT 'remote' NOT NULL,
	"regulation_innings" integer DEFAULT 9 NOT NULL,
	"home_user_id" integer,
	"away_user_id" integer,
	"home_team_id" integer,
	"away_team_id" integer,
	"status" text DEFAULT 'lobby' NOT NULL,
	"winner_side" text,
	"version" integer DEFAULT 0 NOT NULL,
	"state" jsonb NOT NULL,
	"discord_invite_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invites" (
	"code" text PRIMARY KEY NOT NULL,
	"created_by_user_id" integer NOT NULL,
	"used_by_user_id" integer,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "people" (
	"id" serial PRIMARY KEY NOT NULL,
	"bbref_id" varchar(16) NOT NULL,
	"name_first" text NOT NULL,
	"name_last" text NOT NULL,
	"name_given" text,
	"bats" varchar(1),
	"throws" varchar(1),
	"debut_year" integer,
	"final_year" integer,
	"is_starter" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "photos" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner_id" integer NOT NULL,
	"file_name" text NOT NULL,
	"mime" text DEFAULT 'image/jpeg' NOT NULL,
	"width" integer DEFAULT 0 NOT NULL,
	"height" integer DEFAULT 0 NOT NULL,
	"size_bytes" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seasons" (
	"id" serial PRIMARY KEY NOT NULL,
	"person_id" integer NOT NULL,
	"year" integer NOT NULL,
	"team_label" text DEFAULT '' NOT NULL,
	"games" integer DEFAULT 0 NOT NULL,
	"ab" integer DEFAULT 0 NOT NULL,
	"h" integer DEFAULT 0 NOT NULL,
	"avg" double precision,
	"doubles" integer DEFAULT 0 NOT NULL,
	"triples" integer DEFAULT 0 NOT NULL,
	"home_runs" integer DEFAULT 0 NOT NULL,
	"rbi" integer DEFAULT 0 NOT NULL,
	"sb" integer DEFAULT 0 NOT NULL,
	"pa" integer DEFAULT 0 NOT NULL,
	"pitch_games" integer DEFAULT 0 NOT NULL,
	"pitch_ip_outs" integer DEFAULT 0 NOT NULL,
	"pitch_era" double precision,
	"pitch_bf" integer DEFAULT 0 NOT NULL,
	"primary_position" varchar(3),
	"positions_played" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_cards" (
	"id" serial PRIMARY KEY NOT NULL,
	"team_id" integer NOT NULL,
	"user_card_id" integer NOT NULL,
	"added_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"name" text NOT NULL,
	"primary_color" text,
	"lineup" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_cards" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"card_model_id" integer NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"photo_id" integer,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"display_name" text NOT NULL,
	"is_admin" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "card_models" ADD CONSTRAINT "card_models_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_models" ADD CONSTRAINT "card_models_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_participants" ADD CONSTRAINT "draft_participants_draft_id_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_participants" ADD CONSTRAINT "draft_participants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_host_user_id_users_id_fk" FOREIGN KEY ("host_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_events" ADD CONSTRAINT "game_events_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_home_user_id_users_id_fk" FOREIGN KEY ("home_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_away_user_id_users_id_fk" FOREIGN KEY ("away_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_home_team_id_teams_id_fk" FOREIGN KEY ("home_team_id") REFERENCES "public"."teams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_away_team_id_teams_id_fk" FOREIGN KEY ("away_team_id") REFERENCES "public"."teams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_used_by_user_id_users_id_fk" FOREIGN KEY ("used_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photos" ADD CONSTRAINT "photos_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seasons" ADD CONSTRAINT "seasons_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_cards" ADD CONSTRAINT "team_cards_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_cards" ADD CONSTRAINT "team_cards_user_card_id_user_cards_id_fk" FOREIGN KEY ("user_card_id") REFERENCES "public"."user_cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_cards" ADD CONSTRAINT "user_cards_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_cards" ADD CONSTRAINT "user_cards_card_model_id_card_models_id_fk" FOREIGN KEY ("card_model_id") REFERENCES "public"."card_models"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_cards" ADD CONSTRAINT "user_cards_photo_id_photos_id_fk" FOREIGN KEY ("photo_id") REFERENCES "public"."photos"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "card_models_person_year_set_idx" ON "card_models" USING btree ("person_id","card_year","set_label");--> statement-breakpoint
CREATE INDEX "chat_messages_game_idx" ON "chat_messages" USING btree ("game_id");--> statement-breakpoint
CREATE UNIQUE INDEX "draft_participants_idx" ON "draft_participants" USING btree ("draft_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "game_events_game_seq_idx" ON "game_events" USING btree ("game_id","seq");--> statement-breakpoint
CREATE INDEX "games_status_idx" ON "games" USING btree ("status");--> statement-breakpoint
CREATE INDEX "games_home_user_idx" ON "games" USING btree ("home_user_id");--> statement-breakpoint
CREATE INDEX "games_away_user_idx" ON "games" USING btree ("away_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "people_bbref_id_idx" ON "people" USING btree ("bbref_id");--> statement-breakpoint
CREATE INDEX "people_name_idx" ON "people" USING btree ("name_last","name_first");--> statement-breakpoint
CREATE UNIQUE INDEX "seasons_person_year_idx" ON "seasons" USING btree ("person_id","year");--> statement-breakpoint
CREATE INDEX "seasons_year_idx" ON "seasons" USING btree ("year");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "team_cards_unique_idx" ON "team_cards" USING btree ("team_id","user_card_id");--> statement-breakpoint
CREATE INDEX "teams_user_idx" ON "teams" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_cards_user_idx" ON "user_cards" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_cards_model_idx" ON "user_cards" USING btree ("card_model_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree ("email");