CREATE TABLE "sessions" (
	"token_hash" text PRIMARY KEY,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"name" text NOT NULL,
	"username_key" text NOT NULL UNIQUE,
	"password" text NOT NULL,
	"money" double precision DEFAULT 50 NOT NULL,
	"total_rolls" integer DEFAULT 0 NOT NULL,
	"shop_purchases" jsonb NOT NULL,
	"inventory" jsonb NOT NULL,
	"placed_aliens" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;