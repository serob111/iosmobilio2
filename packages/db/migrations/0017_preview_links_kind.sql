CREATE TYPE "public"."preview_link_kind" AS ENUM('editor', 'share');--> statement-breakpoint
DROP INDEX "preview_links_one_active_per_project";--> statement-breakpoint
DROP INDEX "preview_links_one_active_per_draft";--> statement-breakpoint
ALTER TABLE "preview_links" ADD COLUMN "kind" "preview_link_kind" DEFAULT 'share' NOT NULL;--> statement-breakpoint
ALTER TABLE "preview_links" ADD COLUMN "slug_enc" text;--> statement-breakpoint
CREATE UNIQUE INDEX "preview_links_one_active_share_per_project" ON "preview_links" USING btree ("project_id") WHERE "preview_links"."project_id" IS NOT NULL AND "preview_links"."revoked_at" IS NULL AND "preview_links"."kind" = 'share';--> statement-breakpoint
CREATE UNIQUE INDEX "preview_links_one_active_share_per_draft" ON "preview_links" USING btree ("draft_id") WHERE "preview_links"."draft_id" IS NOT NULL AND "preview_links"."revoked_at" IS NULL AND "preview_links"."kind" = 'share';