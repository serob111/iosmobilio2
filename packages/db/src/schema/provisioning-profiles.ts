import { relations } from 'drizzle-orm';
import { pgTable, uuid, text, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { uuidv7 } from 'uuidv7';
import { organizations } from './tenant';
import { projects } from './projects';

/**
 * Caches an Apple-issued Ad Hoc (IOS_APP_ADHOC) provisioning profile per project/bundle
 * id, so a repack build targeting the same device set doesn't have to call back into
 * Apple's own (rate-limited) API every time — reused as long as the device set hasn't
 * changed and the profile isn't within 7 days of expiring (see packages/apple's
 * ensureAdHocProfile). profile_content_enc is the raw .mobileprovision bytes (a signed
 * PKCS#7 blob), AES-256-GCM-encrypted at rest under its own dedicated key
 * (PROVISIONING_PROFILE_KEY) — same one-key-per-concern discipline as
 * BUILD_TOKEN_KEY/PREVIEW_SLUG_KEY, never reusing either of those for this.
 */
export const provisioningProfiles = pgTable(
  'provisioning_profiles',
  {
    id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    bundleId: text('bundle_id').notNull(),
    // sha256 hex of the sorted, comma-joined device id list — lets ensureAdHocProfile
    // tell "same device set" from "changed" with a single indexed equality check
    // instead of comparing arrays.
    devicesHash: text('devices_hash').notNull(),
    // Apple's own resource id for this profile (profiles/{id}) — needed to DELETE it
    // from Apple once a replacement profile has been created and cached in its place.
    profileId: text('profile_id').notNull(),
    profileContentEnc: text('profile_content_enc').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index('provisioning_profiles_org_id_idx').on(table.orgId),
    // One cached profile per project+bundle id — a new device set replaces this row in
    // place rather than inserting a second one (see ensureAdHocProfile's upsert).
    uniqueIndex('provisioning_profiles_project_bundle_unique').on(table.projectId, table.bundleId),
  ],
);

export const provisioningProfilesRelations = relations(provisioningProfiles, ({ one }) => ({
  organization: one(organizations, { fields: [provisioningProfiles.orgId], references: [organizations.id] }),
  project: one(projects, { fields: [provisioningProfiles.projectId], references: [projects.id] }),
}));
