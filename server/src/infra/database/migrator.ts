import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { Pool, PoolClient } from 'pg';

// Plain .sql migrations (07-data/migrations.md): <name>.up.sql / <name>.down.sql, applied in name order,
// each inside its own transaction, under an advisory lock so two processes never migrate at once.
const LOCK_KEY = 727401;

export interface MigrationStatus {
  applied: string[];
  pending: string[];
}

async function listMigrations(dir: string): Promise<string[]> {
  const files = await readdir(dir);
  return files
    .filter((f) => f.endsWith('.up.sql'))
    .map((f) => f.slice(0, -'.up.sql'.length))
    .sort();
}

async function ensureTable(client: PoolClient): Promise<void> {
  await client.query(
    'CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())',
  );
}

async function appliedNames(client: PoolClient): Promise<string[]> {
  const res = await client.query<{ name: string }>('SELECT name FROM schema_migrations ORDER BY name');
  return res.rows.map((r) => r.name);
}

async function withLock<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
    try {
      await ensureTable(client);
      return await fn(client);
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]);
    }
  } finally {
    client.release();
  }
}

async function runInTx(client: PoolClient, name: string, sql: string, record: string, params: unknown[]): Promise<void> {
  await client.query('BEGIN');
  try {
    await client.query(sql);
    await client.query(record, params);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw new Error(`migration ${name} failed: ${(err as Error).message}`);
  }
}

/** Applies all pending migrations; returns the names applied, in order. */
export async function migrateUp(pool: Pool, dir: string): Promise<string[]> {
  return withLock(pool, async (client) => {
    const done = new Set(await appliedNames(client));
    const pending = (await listMigrations(dir)).filter((n) => !done.has(n));
    for (const name of pending) {
      const sql = await readFile(path.join(dir, `${name}.up.sql`), 'utf8');
      await runInTx(client, name, sql, 'INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
    }
    return pending;
  });
}

/** Rolls back the last `steps` applied migrations; returns the names rolled back, newest first. */
export async function migrateDown(pool: Pool, dir: string, steps = 1): Promise<string[]> {
  return withLock(pool, async (client) => {
    const targets = (await appliedNames(client)).reverse().slice(0, steps);
    for (const name of targets) {
      const sql = await readFile(path.join(dir, `${name}.down.sql`), 'utf8');
      await runInTx(client, name, sql, 'DELETE FROM schema_migrations WHERE name = $1', [name]);
    }
    return targets;
  });
}

export async function migrationStatus(pool: Pool, dir: string): Promise<MigrationStatus> {
  return withLock(pool, async (client) => {
    const applied = await appliedNames(client);
    const done = new Set(applied);
    const pending = (await listMigrations(dir)).filter((n) => !done.has(n));
    return { applied, pending };
  });
}
