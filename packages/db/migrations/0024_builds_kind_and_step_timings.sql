CREATE TYPE "public"."build_kind" AS ENUM('adhoc', 'appstore');--> statement-breakpoint
ALTER TABLE "builds" ADD COLUMN "kind" "build_kind" DEFAULT 'adhoc' NOT NULL;--> statement-breakpoint
ALTER TABLE "builds" ADD COLUMN "step_timings" jsonb;