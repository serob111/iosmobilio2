import { relations } from 'drizzle-orm';
import { pgTable, uuid, text, integer, timestamp, jsonb, index } from 'drizzle-orm/pg-core';
import { uuidv7 } from 'uuidv7';
import { organizations } from './tenant';

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
    // Which version of @mobilio/config's ProjectConfigSchema `config` conforms to —
    // written on every insert/update (see apps/api's ProjectsService). Lets a future
    // schema change ship a one-off migration that only touches rows below the current
    // version, instead of having to re-validate/guess the shape of every row's jsonb.
    configVersion: integer('config_version').notNull().default(1),
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
