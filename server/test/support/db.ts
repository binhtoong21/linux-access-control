import { Kysely, PostgresDialect } from 'kysely';
import path from 'node:path';
import { Pool } from 'pg';
import { migrateUp } from '../../src/infra/database/migrator';
import { Database } from '../../src/infra/database/schema';

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

/** Wipes the disposable test database and applies all migrations. Caller ends the returned pool. */
export async function resetDatabase(url: string): Promise<Pool> {
  const pool = new Pool({ connectionString: url });
  await pool.query('DROP SCHEMA public CASCADE');
  await pool.query('CREATE SCHEMA public');
  await migrateUp(pool, path.resolve(__dirname, '../../migrations'));
  return pool;
}

/** Kysely over an existing pool; end the pool, not Kysely, when done. */
export function kyselyOn(pool: Pool): Kysely<Database> {
  return new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
}
