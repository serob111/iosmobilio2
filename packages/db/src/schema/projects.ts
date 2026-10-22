import { relations } from 'drizzle-orm';
import { pgTable, uuid, text, timestamp, jsonb, index } from 'drizzle-orm/pg-core';
import { uuidv7 } from 'uuidv7';
import { organizations } from './tenant';

/**
 * Empty for now — not read or written by any app code yet. Scaffolded here so RLS
 * (packages/db/migrations) and the tenant-isolation tests have a second org_id-scoped
 * table to prove the policy generalizes beyond `memberships`/`invitations`. Real
 * project data migrates from apps/web's file storage in Этап 2.
 */
export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    sourceUrl: text('source_url').notNull(),
    config: jsonb('config').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index('projects_org_id_idx').on(table.orgId)],
);

export const projectsRelations = relations(projects, ({ one }) => ({
  organization: one(organizations, { fields: [projects.orgId], references: [organizations.id] }),
}));
