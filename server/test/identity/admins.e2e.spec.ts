import { Pool } from 'pg';
import { createAdmin } from '../../src/identity/admin-accounts';
import { AdminsService } from '../../src/identity/admins.service';
import { AppError } from '../../src/shared/http/app-error';
import { startApp, TestApp } from '../support/app';
import { kyselyOn, resetDatabase, TEST_DATABASE_URL } from '../support/db';

const ROOT_PASSWORD = 'root-password-1';

(TEST_DATABASE_URL ? describe : describe.skip)('admin management', () => {
  let pool: Pool;
  let ctx: TestApp;
  let rootId: string;
  let cookie: string;
  const saved = { db: process.env.DATABASE_URL, jwt: process.env.JWT_SECRET };

  const call = (method: string, path: string, body?: unknown, withCookie = true) =>
    fetch(`${ctx.base}/api/v1${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'dashboard',
        ...(withCookie ? { Cookie: cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const login = async (username: string, password: string): Promise<Response> =>
    call('POST', '/auth/login', { username, password }, false);
  const codeOf = async (res: Response): Promise<string> =>
    ((await res.json()) as { error: { code: string } }).error.code;
  const auditCount = async (action: string, entityId: string): Promise<number> =>
    (await pool.query('SELECT 1 FROM admin_audit_logs WHERE action = $1 AND entity_id = $2', [action, entityId])).rowCount ?? 0;

  beforeAll(async () => {
    pool = await resetDatabase(TEST_DATABASE_URL as string);
    rootId = (await createAdmin(kyselyOn(pool), { username: 'root', displayName: 'Root', password: ROOT_PASSWORD }, null)).id;
    ctx = await startApp(TEST_DATABASE_URL as string);
    cookie = ((await login('root', ROOT_PASSWORD)).headers.get('set-cookie') ?? '').split(';')[0];
  });

  afterAll(async () => {
    await ctx.app.close();
    await pool.end();
    process.env.DATABASE_URL = saved.db;
    process.env.JWT_SECRET = saved.jwt;
  });

  let opsId: string;

  it('requires a session', async () => {
    const res = await call('GET', '/admins', undefined, false);
    expect(res.status).toBe(401);
  });

  it('creates an admin and audits it with the acting admin', async () => {
    const res = await call('POST', '/admins', { username: 'ops', display_name: 'Ops', password: 'ops-password-1' });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; username: string; status: string };
    expect(body).toMatchObject({ username: 'ops', status: 'active' });
    expect(body).not.toHaveProperty('password_hash');
    opsId = body.id;
    const audit = await pool.query("SELECT admin_id FROM admin_audit_logs WHERE action = 'admin.create' AND entity_id = $1", [opsId]);
    expect(audit.rows).toEqual([{ admin_id: rootId }]);
  });

  it('rejects a duplicate username and a short password', async () => {
    const dup = await call('POST', '/admins', { username: ' OPS ', display_name: 'x', password: 'ops-password-1' });
    expect(dup.status).toBe(409);
    expect(await codeOf(dup)).toBe('DUPLICATE');
    const short = await call('POST', '/admins', { username: 'tiny', display_name: 'x', password: 'short' });
    expect(short.status).toBe(400);
    expect(await codeOf(short)).toBe('VALIDATION_ERROR');
  });

  it('lists admins without password hashes', async () => {
    const res = await call('GET', '/admins');
    const list = (await res.json()) as Record<string, unknown>[];
    expect(list.map((a) => a.username)).toEqual(['root', 'ops']);
    expect(list.every((a) => !('password_hash' in a))).toBe(true);
  });

  it('disables and enables with one audit row per real change', async () => {
    const off = await call('POST', `/admins/${opsId}/disable`);
    expect(off.status).toBe(200);
    expect(((await off.json()) as { status: string }).status).toBe('disabled');
    expect((await call('POST', `/admins/${opsId}/disable`)).status).toBe(200);
    expect(await auditCount('admin.disable', opsId)).toBe(1);
    const on = await call('POST', `/admins/${opsId}/enable`);
    expect(((await on.json()) as { status: string }).status).toBe('active');
    expect(await auditCount('admin.enable', opsId)).toBe(1);
  });

  it('refuses to disable the last active admin', async () => {
    await call('POST', `/admins/${opsId}/disable`);
    const res = await call('POST', `/admins/${rootId}/disable`);
    expect(res.status).toBe(409);
    expect(await codeOf(res)).toBe('LAST_ACTIVE_ADMIN');
    await call('POST', `/admins/${opsId}/enable`);
  });

  it('keeps one active admin when two disables race (row locks)', async () => {
    const svc = ctx.app.get(AdminsService);
    const results = await Promise.allSettled([
      svc.setStatus(rootId, 'disabled', rootId),
      svc.setStatus(opsId, 'disabled', rootId),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(AppError);
    expect((rejected.reason as AppError).code).toBe('LAST_ACTIVE_ADMIN');
    const active = await pool.query("SELECT 1 FROM admin_accounts WHERE status = 'active'");
    expect(active.rowCount).toBe(1);
    // restore both for the next tests
    await pool.query("UPDATE admin_accounts SET status = 'active'");
  });

  it('answers 404 for an unknown id and 400 for a malformed one', async () => {
    const missing = await call('POST', '/admins/00000000-0000-4000-8000-000000000000/disable');
    expect(missing.status).toBe(404);
    expect(await codeOf(missing)).toBe('NOT_FOUND');
    const bad = await call('POST', '/admins/not-a-uuid/disable');
    expect(bad.status).toBe(400);
    expect(await codeOf(bad)).toBe('VALIDATION_ERROR');
  });

  it('changes the own password only with the right current password', async () => {
    const wrong = await call('POST', '/admins/me/password', { current_password: 'nope-nope-nope', new_password: 'new-root-password' });
    expect(wrong.status).toBe(400);
    expect(await codeOf(wrong)).toBe('VALIDATION_ERROR');
    const ok = await call('POST', '/admins/me/password', { current_password: ROOT_PASSWORD, new_password: 'new-root-password' });
    expect(ok.status).toBe(204);
    expect(await auditCount('admin.password_change', rootId)).toBe(1);
    expect((await login('root', 'new-root-password')).status).toBe(204);
    expect((await login('root', ROOT_PASSWORD)).status).toBe(401);
  });
});
