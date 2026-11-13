CREATE TABLE "preview_links" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid,
	"project_id" uuid,
	"draft_id" uuid,
	"slug_hash" text NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "preview_links_slug_hash_unique" UNIQUE("slug_hash"),
	CONSTRAINT "preview_links_exactly_one_owner" CHECK ((
        ("preview_links"."project_id" IS NOT NULL AND "preview_links"."draft_id" IS NULL AND "preview_links"."org_id" IS NOT NULL)
        OR
        ("preview_links"."project_id" IS NULL AND "preview_links"."draft_id" IS NOT NULL AND "preview_links"."org_id" IS NULL)
      ))
);
--> statement-breakpoint
ALTER TABLE "preview_links" ADD CONSTRAINT "preview_links_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preview_links" ADD CONSTRAINT "preview_links_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preview_links" ADD CONSTRAINT "preview_links_draft_id_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "preview_links_org_id_idx" ON "preview_links" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "preview_links_project_id_idx" ON "preview_links" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "preview_links_draft_id_idx" ON "preview_links" USING btree ("draft_id");--> statement-breakpoint
CREATE UNIQUE INDEX "preview_links_one_active_per_project" ON "preview_links" USING btree ("project_id") WHERE "preview_links"."project_id" IS NOT NULL AND "preview_links"."revoked_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "preview_links_one_active_per_draft" ON "preview_links" USING btree ("draft_id") WHERE "preview_links"."draft_id" IS NOT NULL AND "preview_links"."revoked_at" IS NULL;