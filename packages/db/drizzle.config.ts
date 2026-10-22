import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
  dbCredentials: {
    url: process.env.MIGRATOR_DATABASE_URL ?? 'postgres://mobilio_migrator:mobilio_migrator@localhost:5433/mobilio',
  },
});
