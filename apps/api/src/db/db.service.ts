import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { createDb, type Db } from '@mobilio/db';

/**
 * Wraps the mobilio_app connection pool. `db` is intentionally the *unscoped* instance
 * — fine for tables without RLS (`users`, `sessions`, etc. — Better Auth's own
 * queries), but org_id-scoped tables (`memberships`, `invitations`, `projects`) must
 * only ever be queried through `runInTenantContext(dbService.db, ...)`, never directly,
 * since RLS has nothing to filter on outside that transaction.
 */
@Injectable()
export class DbService implements OnModuleDestroy {
  readonly db: Db;
  private readonly pool: ReturnType<typeof createDb>['pool'];

  constructor() {
    const { pool, db } = createDb(
      process.env.DATABASE_URL ?? 'postgres://mobilio_app:mobilio_app_pw@localhost:5433/mobilio',
    );
    this.pool = pool;
    this.db = db;
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
