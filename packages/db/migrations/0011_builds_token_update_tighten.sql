-- builds_token_update's WITH CHECK was deliberately "true" (0009_builds_token_access.sql)
-- so the legitimate transitions (building -> done/failed, clearing token_hash) weren't
-- blocked by re-applying USING's "status IN ('queued','building')" to the new row. But
-- "true" also means an UPDATE statement with a bug (or a crafted one, if the app layer
-- were ever compromised) could rewrite token_hash to an attacker-chosen value, or move
-- status to 'queued' — i.e. resurrect/forge a different build's identity through this
-- same token. The real constraint the application only ever needs is: the new status
-- must be one this token could legitimately produce (never 'queued' — nothing ever
-- transitions INTO queued via UPDATE, only INSERT), and if token_hash isn't being
-- cleared to NULL, it must stay exactly what it already was.
DROP POLICY "builds_token_update" ON "builds";
--> statement-breakpoint

CREATE POLICY "builds_token_update" ON "builds"
  FOR UPDATE
  USING (
    "token_hash" = nullif(current_setting('app.lookup_token_hash', true), '')
    AND "token_expires_at" > now()
    AND "status" IN ('queued', 'building')
  )
  WITH CHECK (
    "status" IN ('building', 'done', 'failed')
    AND (
      "token_hash" IS NULL
      OR "token_hash" = nullif(current_setting('app.lookup_token_hash', true), '')
    )
  );
--> statement-breakpoint

-- Defense in depth on top of the WITH CHECK above: id/org_id/project_id/created_at
-- should never change under any UPDATE, by any role, regardless of which RLS policy let
-- the UPDATE through — a bug in application code (or a future policy change) rewriting
-- one of these would silently reassign a build to a different org/project, which RLS
-- alone can't catch (WITH CHECK only sees token_hash/status, it was never meant to also
-- police every other column). FORCE ROW LEVEL SECURITY already makes mobilio_migrator
-- subject to the same RLS as mobilio_app, but a trigger fires for every role
-- unconditionally — simpler and more obviously correct than trying to express
-- "columns X/Y/Z are immutable" as another RLS predicate.
CREATE FUNCTION "builds_prevent_immutable_field_changes"() RETURNS trigger AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'builds.id is immutable';
  END IF;
  IF NEW.org_id IS DISTINCT FROM OLD.org_id THEN
    RAISE EXCEPTION 'builds.org_id is immutable';
  END IF;
  IF NEW.project_id IS DISTINCT FROM OLD.project_id THEN
    RAISE EXCEPTION 'builds.project_id is immutable';
  END IF;
  IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'builds.created_at is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER "builds_immutable_fields"
  BEFORE UPDATE ON "builds"
  FOR EACH ROW
  EXECUTE FUNCTION "builds_prevent_immutable_field_changes"();
