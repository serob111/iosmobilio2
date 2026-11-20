CREATE TABLE "shell_releases" (
	"id" uuid PRIMARY KEY NOT NULL,
	"version" text NOT NULL,
	"ipa_key" text NOT NULL,
	"manifest" jsonb NOT NULL,
	"sha256" text NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "shell_releases_version_unique" ON "shell_releases" USING btree ("version");--> statement-breakpoint
CREATE UNIQUE INDEX "shell_releases_one_active" ON "shell_releases" USING btree ("is_active") WHERE "shell_releases"."is_active";