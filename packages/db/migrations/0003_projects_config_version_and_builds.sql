CREATE TYPE "public"."build_status" AS ENUM('queued', 'building', 'done', 'failed');--> statement-breakpoint
CREATE TABLE "builds" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"status" "build_status" DEFAULT 'queued' NOT NULL,
	"run_id" integer,
	"run_url" text,
	"error" text,
	"template_version" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"ipa_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "config_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "builds" ADD CONSTRAINT "builds_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "builds" ADD CONSTRAINT "builds_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "builds_org_id_idx" ON "builds" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "builds_project_id_idx" ON "builds" USING btree ("project_id");