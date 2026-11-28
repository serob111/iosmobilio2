# Architecture

Prose overview, no code — see [[STATUS]] for current progress and [[README]] (`decisions/`)
for why each piece is shaped this way.

## Database & RLS model

Postgres, two roles: `mobilio_migrator` (schema owner, runs migrations) and `mobilio_app`
(what `api`/`worker` connect as, no `BYPASSRLS`). Every org-scoped table (`projects`,
`memberships`, `invitations`, and `organizations` itself) has RLS **enabled and forced** —
forced so even the schema owner can't bypass it. The base policy: a row is visible/writable
only if its `org_id` (or, for `organizations`, its own `id`) matches
`current_setting('app.org_id')`, a transaction-scoped `SET LOCAL` set only inside a
`runIn*Context()` call — outside one, the setting is unset and queries return zero rows
(fail closed), never an error. A handful of narrower cases layer additional, equally-scoped
policies on top: "my organizations" by `app.user_id` (no `org_id` yet known), invitation
acceptance and draft/build/preview access by a hashed capability token
(`app.lookup_token_hash` / `app.lookup_slug_hash`), and the repack worker/build runner by a
single project id it was handed, never a whole org. Better Auth's own tables (`users`,
`sessions`, `accounts`, `verifications`) are deliberately outside RLS — they're global
identity, not org data; nothing but Better Auth and `AuthGuard` touches them directly. See
[[2026-10-20-multitenancy-postgres-rls]].

## Draft & project lifecycle

A visitor gets a free, no-login preview: entering a URL creates a **draft** (own table, no
`org_id`), identified only by a random token in an httpOnly cookie — the database stores just
its sha256 hash. "Save as project" sends the visitor through sign-in (magic link or Google);
first sign-in auto-creates a personal organization, and the draft is **claimed**: atomically
deleted and re-inserted as a real project owned by that organization, in one transaction, so a
double-click or a race can't double-claim it. See [[2026-10-23-anonymous-drafts-cookie-claim]].

## Builds

`BuildRunner` is the abstraction (`dispatch(build)`); three implementations exist —
`GithubActionsRunner` (macOS CI build from source, the original path), `RepackRunner`
(unzips a pre-built shell `.ipa`, patches identity/config/icon/splash, re-signs, re-zips —
the current direction, see [[STATUS]]), and `FakeRunner` for tests. Each build gets a
short-lived, single-use token; the runner never gets a user identity, only that token and
the one project it's scoped to. `shell_releases` holds the compiled shell base builds that
`RepackRunner` starts from — rows are immutable once registered. A watchdog
(`apps/worker`, periodic) fails builds a runner silently abandoned, so a dead CI job or crashed
repack worker can't hold a project's one-active-build slot forever; Ad Hoc builds use their
own, shorter watchdog thresholds than CI-sourced builds. See
[[2026-11-21-repack-not-full-build-for-adhoc]].

## Preview proxy

A preview link is a capability URL: the database stores only a hash of the slug, never the
slug itself. **Editor** links (shown while building the project) and **share** links (meant
to be sent to someone else) are separate capabilities, not the same link with different UI —
revoking one never revokes the other. Each preview gets its **own origin**:
`<slug>.<PREVIEW_PROXY_DOMAIN>` is a distinct browser origin per preview, so two previews'
cookies/localStorage can never cross — enforced by the browser itself, not by proxy code.
The proxy fetches only from the project's own source host (never from `allowedDomains`, which
the project owner controls and could point anywhere), strips cookies/security headers from
the upstream response, and rewrites HTML/CSS references to stay on the preview's own origin.
Browser-level isolation is reinforced, not replaced, by submitting `PREVIEW_PROXY_DOMAIN` to
the Public Suffix List before public launch. See
[[2026-10-28-preview-proxy-capability-slug]].

## Authorization

Session identity is an httpOnly cookie, shared across `apps/web`/`apps/api` (different
origins, CORS with credentials). Every unsafe method on a cookie-authorized route is also
checked against `Origin`/`Referer` by a CSRF middleware mounted ahead of normal routing —
cookies attach to cross-site requests automatically, so Origin-checking is the only thing
stopping a third-party site from riding a victim's session. The two exceptions are Better
Auth's own routes (own trusted-origin mechanism) and the build-runner endpoints, which use a
`Bearer <buildToken>` instead of a cookie — a header a foreign site's script can't attach
automatically, so there's nothing for Origin-checking to defend there.

## Storage

Project icons and build `.ipa`s live in S3-compatible object storage (MinIO locally/CI,
Cloudflare R2 in production) behind a single `ObjectStorage` interface — never on local disk,
never served as public objects. Everything is reached through short-lived signed URLs or
streamed through `apps/api`'s own origin (needed specifically where a request must carry
browser credentials through a redirect, which a wildcard-CORS S3 response can't satisfy).
Object keys are namespaced by org/project/build id; see [[STATUS]] for which storage-backed
features (shell release manifests, repack provisioning-profile cache) are live.
