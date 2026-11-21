CREATE TABLE "provisioning_profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"bundle_id" text NOT NULL,
	"devices_hash" text NOT NULL,
	"profile_id" text NOT NULL,
	"profile_content_enc" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "provisioning_profiles" ADD CONSTRAINT "provisioning_profiles_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provisioning_profiles" ADD CONSTRAINT "provisioning_profiles_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "provisioning_profiles_org_id_idx" ON "provisioning_profiles" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "provisioning_profiles_project_bundle_unique" ON "provisioning_profiles" USING btree ("project_id","bundle_id");