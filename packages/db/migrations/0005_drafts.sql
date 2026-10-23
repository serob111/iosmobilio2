CREATE TABLE "drafts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"source_url" text NOT NULL,
	"config" jsonb NOT NULL,
	"config_version" integer DEFAULT 1 NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "drafts_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE INDEX "drafts_expires_at_idx" ON "drafts" USING btree ("expires_at");