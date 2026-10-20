import { relations } from 'drizzle-orm';
import { pgTable, uuid, text, timestamp, pgEnum, index, unique } from 'drizzle-orm/pg-core';
import { uuidv7 } from 'uuidv7';
import { users } from './auth';

export const orgRole = pgEnum('org_role', ['owner', 'admin', 'member']);

export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const memberships = pgTable(
  'memberships',
  {
    id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    role: orgRole('role').notNull().default('member'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('memberships_org_id_idx').on(table.orgId),
    index('memberships_user_id_idx').on(table.userId),
    unique('memberships_user_org_unique').on(table.userId, table.orgId),
  ],
);

export const invitations = pgTable(
  'invitations',
  {
    id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: orgRole('role').notNull().default('member'),
    // SHA-256 hex of the raw invite token — only the hash is persisted, the raw token
    // is handed to the invitee once (in the invite link) and never stored.
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('invitations_org_id_idx').on(table.orgId)],
);

export const organizationsRelations = relations(organizations, ({ many }) => ({
  memberships: many(memberships),
  invitations: many(invitations),
}));

export const membershipsRelations = relations(memberships, ({ one }) => ({
  user: one(users, { fields: [memberships.userId], references: [users.id] }),
  organization: one(organizations, { fields: [memberships.orgId], references: [organizations.id] }),
}));

export const invitationsRelations = relations(invitations, ({ one }) => ({
  organization: one(organizations, { fields: [invitations.orgId], references: [organizations.id] }),
}));
