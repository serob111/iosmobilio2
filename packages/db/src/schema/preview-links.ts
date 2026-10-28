import { relations, sql } from 'drizzle-orm';
import { pgTable, uuid, text, timestamp, index, uniqueIndex, check } from 'drizzle-orm/pg-core';
import { uuidv7 } from 'uuidv7';
import { organizations } from './tenant';
import { projects } from './projects';
import { drafts } from './drafts';

/**
 * A capability URL ("whoever has the slug can view the preview") for either a project
 * (org-owned) or a draft (anonymous, token-owned) — exactly one of project_id/draft_id is
 * set, never both, never neither (see the CHECK below). org_id is carried alongside
 * project_id purely so the org-isolation RLS policy (packages/db/migrations) has a column
 * to key on without an extra join; it's NULL whenever project_id is NULL, same reasoning
 * as builds.org_id but one level more optional here since a draft-backed row has no org at
 * all yet.
 */
export const previewLinks = pgTable(
  'preview_links',
  {
    id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
    orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    draftId: uuid('draft_id').references(() => drafts.id, { onDelete: 'cascade' }),
    // SHA-256 hex of the raw slug (22-char base64url, 16 random bytes) — same convention
    // as every other capability token in this schema (drafts.token_hash, invitations.
    // token_hash): only the hash is ever persisted, the raw slug lives in the URL itself.
    slugHash: text('slug_hash').notNull().unique(),
    // NULL for a project-backed link (lives until explicitly revoked/regenerated); for a
    // draft-backed link this is set equal to the draft's own expires_at at creation time —
    // see PreviewLinkService.createForDraft.
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => [
    index('preview_links_org_id_idx').on(table.orgId),
    index('preview_links_project_id_idx').on(table.projectId),
    index('preview_links_draft_id_idx').on(table.draftId),
    // At most one *active* (not revoked) link per project/draft — regenerating revokes
    // the old one first (PreviewLinkService), this index is the backstop against two
    // concurrent regenerate calls both leaving a live row behind.
    uniqueIndex('preview_links_one_active_per_project')
      .on(table.projectId)
      .where(sql`${table.projectId} IS NOT NULL AND ${table.revokedAt} IS NULL`),
    uniqueIndex('preview_links_one_active_per_draft')
      .on(table.draftId)
      .where(sql`${table.draftId} IS NOT NULL AND ${table.revokedAt} IS NULL`),
    check(
      'preview_links_exactly_one_owner',
      sql`(
        (${table.projectId} IS NOT NULL AND ${table.draftId} IS NULL AND ${table.orgId} IS NOT NULL)
        OR
        (${table.projectId} IS NULL AND ${table.draftId} IS NOT NULL AND ${table.orgId} IS NULL)
      )`,
    ),
  ],
);

export const previewLinksRelations = relations(previewLinks, ({ one }) => ({
  organization: one(organizations, { fields: [previewLinks.orgId], references: [organizations.id] }),
  project: one(projects, { fields: [previewLinks.projectId], references: [projects.id] }),
  draft: one(drafts, { fields: [previewLinks.draftId], references: [drafts.id] }),
}));
