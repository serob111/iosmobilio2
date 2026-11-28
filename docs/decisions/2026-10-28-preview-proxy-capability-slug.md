# Preview via capability-slug proxy on its own domain; editor/share links split; PSL is the real boundary

**Date:** 2026-10-28 (`c3fc000`, preview-link capability URLs) through 2026-10-29 (`79f6d8a`,
per-preview subdomain origin) and 2026-11-06 (`f2e86d9`, editor/share split).

**Decision:** A preview link is a capability URL — the database stores a hash of a
high-entropy slug, never the slug itself. Each preview is served from its **own origin**
(`<slug>.<PREVIEW_PROXY_DOMAIN>`, a dedicated domain, not a path under the main site), and
"editor" links (used while building) are a distinct capability from "share" links (handed to
someone else), so revoking one never revokes the other. Before public launch,
`PREVIEW_PROXY_DOMAIN` must be submitted to the Public Suffix List — the in-app cookie
interceptor is explicitly documented as best-effort, not the real isolation boundary.

**Why:** A per-subdomain origin makes preview-to-preview cookie/localStorage isolation a
browser guarantee (same-origin policy), not application code that has to remember to enforce
it. Splitting editor/share links means sharing a preview with a client doesn't also hand them
a link that keeps working after the project owner stops editing, and vice versa. PSL
submission matters because without it, a malicious page inside one preview could still try to
claim the whole `PREVIEW_PROXY_DOMAIN` as its "site" for storage-partitioning purposes — PSL
is what makes browsers treat each `<slug>.<domain>` as a genuinely separate site, not a
best-effort JS interceptor trying to approximate the same thing.

**Rejected:** A single shared origin with a `/s/:slug/*` path prefix (the original Этап-2
design) — replaced because a shared origin can't give two previews true storage isolation no
matter how carefully cookies are filtered; one capability link serving both editor and share
purposes (simpler, but conflates two different trust/lifetime requirements).

See [[ARCHITECTURE]], [[STATUS]].
