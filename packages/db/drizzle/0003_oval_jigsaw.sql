CREATE TABLE "tournaments" (
	"id" serial PRIMARY KEY NOT NULL,
	"host_user_id" integer NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'lobby' NOT NULL,
	"config" jsonb NOT NULL,
	"state" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_host_user_id_users_id_fk" FOREIGN KEY ("host_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;