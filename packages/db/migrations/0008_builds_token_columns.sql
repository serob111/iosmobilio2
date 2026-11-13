ALTER TABLE "builds" ADD COLUMN "token_hash" text;--> statement-breakpoint
ALTER TABLE "builds" ADD COLUMN "token_expires_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "builds_one_active_per_project" ON "builds" USING btree ("project_id") WHERE "builds"."status" IN ('queued', 'building');