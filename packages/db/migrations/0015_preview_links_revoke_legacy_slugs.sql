-- The raw preview slug's own format changed (22-char base64url -> 26-char lowercase
-- base32, [a-z2-7]) to become valid as a DNS label for the new per-preview subdomain
-- proxy origin (https://<slug>.<PREVIEW_PROXY_DOMAIN>/<path>). Every existing active
-- link was minted under the old format and would simply 404 against the new subdomain
-- validation regardless (wrong length, wrong charset) — revoking them here is hygiene,
-- not a functional requirement, so no row is left silently unusable-but-not-revoked.
UPDATE "preview_links" SET "revoked_at" = now() WHERE "revoked_at" IS NULL;
