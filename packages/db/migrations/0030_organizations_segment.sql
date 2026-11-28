CREATE TYPE "public"."org_segment" AS ENUM('owner', 'agency', 'developer');--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "segment" "org_segment";