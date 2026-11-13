import { Global, Inject, Logger, Module, OnApplicationShutdown } from '@nestjs/common';
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { APP_CONFIG, AppConfig } from '../../config';
import { Database } from './schema';

export const PG_POOL = Symbol('PG_POOL');
export const KYSELY = Symbol('KYSELY');
export type Db = Kysely<Database>;

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): Pool => {
        const pool = new Pool({ connectionString: config.databaseUrl, max: 10, connectionTimeoutMillis: 5000 });
        // An idle client losing its connection must not crash the process; the next query reconnects.
        pool.on('error', (err) => new Logger('Database').error(`idle client error: ${err.message}`));
        return pool;
      },
    },
    {
      provide: KYSELY,
      inject: [PG_POOL],
      // Shares the pool; Kysely.destroy() is never called because it would end the same pool a second time.
      useFactory: (pool: Pool): Db => new Kysely<Database>({ dialect: new PostgresDialect({ pool }) }),
    },
  ],
  exports: [PG_POOL, KYSELY],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
