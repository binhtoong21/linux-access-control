import { Pool } from 'pg';
import { createAdmin } from '../../src/identity/admin-accounts';
import { startApp, TestApp } from './app';
import { kyselyOn, resetDatabase } from './db';

const ENV_KEYS = ['DATABASE_URL', 'JWT_SECRET', 'KEYS_DIR', 'UID_ENC_KEY_ID'] as const;

export interface ApiContext {
  pool: Pool;
  ctx: TestApp;
  adminId: string;
  call: (method: string, path: string, body?: unknown) => Promise<Response>;
  close: () => Promise<void>;
}

/** Fresh test database, one admin, the app, and a signed-in caller that sends the CSRF header. */
export async function startSignedIn(databaseUrl: string): Promise<ApiContext> {
  const saved = ENV_KEYS.map((k) => [k, process.env[k]] as const);
  const pool = await resetDatabase(databaseUrl);
  const adminId = (await createAdmin(kyselyOn(pool), { username: 'root', displayName: 'Root', password: 'root-password-1' }, null)).id;
  const ctx = await startApp(databaseUrl);
  const send = (method: string, path: string, body: unknown, cookie?: string): Promise<Response> =>
    fetch(`${ctx.base}/api/v1${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'dashboard', ...(cookie ? { Cookie: cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const login = await send('POST', '/auth/login', { username: 'root', password: 'root-password-1' });
  const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
  return {
    pool,
    ctx,
    adminId,
    call: (method, path, body) => send(method, path, body, cookie),
    close: async () => {
      await ctx.app.close();
      await pool.end();
      for (const [k, v] of saved) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    },
  };
}

export async function errorCode(res: Response): Promise<string> {
  return ((await res.json()) as { error: { code: string } }).error.code;
}

export async function outboxEvents(pool: Pool, aggregateId: string): Promise<{ event_type: string; payload: unknown }[]> {
  const res = await pool.query('SELECT event_type, payload FROM server_outbox WHERE aggregate_id = $1 ORDER BY id', [aggregateId]);
  return res.rows;
}

export async function auditActions(pool: Pool, entityId: string): Promise<string[]> {
  const res = await pool.query('SELECT action FROM admin_audit_logs WHERE entity_id = $1 ORDER BY id', [entityId]);
  return res.rows.map((r: { action: string }) => r.action);
}
