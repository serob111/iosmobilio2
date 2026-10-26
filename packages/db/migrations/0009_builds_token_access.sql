-- The build runner (GitHub Actions today, a template-repack step later) authenticates
-- with a one-off bearer token, not an org session — same "identity via token, not
-- membership" shape as drafts_token_access, scoped here to SELECT/UPDATE only (the
-- runner never creates or deletes a build row, only reads and transitions one that
-- already exists). Two policies, not one FOR ALL: Postgres policies can only target ALL
-- or a single command, and this intentionally excludes INSERT/DELETE.
--
-- status IN ('queued','building') is enforced here too, not just by the application's
-- own state machine — once a build finishes (done/failed) the token stops working even
-- before token_hash is cleared to NULL, and even before its 2h TTL would otherwise expire.
CREATE POLICY "builds_token_select" ON "builds"
  FOR SELECT
  USING (
    "token_hash" = nullif(current_setting('app.lookup_token_hash', true), '')
    AND "token_expires_at" > now()
    AND "status" IN ('queued', 'building')
  );
--> statement-breakpoint

-- WITH CHECK is deliberately "true", not a repeat of USING: the whole point of the
-- allowed transitions (building -> done/failed) is to move a row OUT of the state USING
-- requires (clearing token_hash, changing status to done/failed) — reusing USING as the
-- implicit WITH CHECK would make exactly those legitimate updates fail. USING on the OLD
-- row already proved the caller held the right token for a live build; once past that
-- gate, the application layer (not another RLS predicate) is what decides which columns
-- actually get written in any given UPDATE statement.
CREATE POLICY "builds_token_update" ON "builds"
  FOR UPDATE
  USING (
    "token_hash" = nullif(current_setting('app.lookup_token_hash', true), '')
    AND "token_expires_at" > now()
    AND "status" IN ('queued', 'building')
  )
  WITH CHECK (true);
