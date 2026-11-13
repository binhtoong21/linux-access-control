import { Pool } from 'pg';
import { hashPassword } from '../../src/identity/password';
import { startApp, TestApp } from '../support/app';
import { resetDatabase, TEST_DATABASE_URL } from '../support/db';

const WRITE = { 'Content-Type': 'application/json', 'X-Requested-With': 'dashboard' };
const PASSWORD = 'root-password-1';

(TEST_DATABASE_URL ? describe : describe.skip)('admin auth over HTTP', () => {
  let pool: Pool;
  let ctx: TestApp;
  const saved = { db: process.env.DATABASE_URL, jwt: process.env.JWT_SECRET };

  beforeAll(async () => {
    pool = await resetDatabase(TEST_DATABASE_URL as string);
    const h = await hashPassword(PASSWORD);
    await pool.query(
      `INSERT INTO admin_accounts (username, display_name, password_hash)
       VALUES ('root', 'Root', $1), ('victim', 'Victim', $1), ('locked', 'Locked', $1)`,
      [h],
    );
    ctx = await startApp(TEST_DATABASE_URL as string);
  });

  afterAll(async () => {
    await ctx.app.close();
    await pool.end();
    process.env.DATABASE_URL = saved.db;
    process.env.JWT_SECRET = saved.jwt;
  });

  const login = (username: string, password: string, headers: Record<string, string> = WRITE) =>
    fetch(`${ctx.base}/api/v1/auth/login`, { method: 'POST', headers, body: JSON.stringify({ username, password }) });
  const cookieOf = (res: Response): string => (res.headers.get('set-cookie') ?? '').split(';')[0];
  const me = (cookie?: string) =>
    fetch(`${ctx.base}/api/v1/auth/me`, { headers: cookie ? { Cookie: cookie } : {} });
  const codeOf = async (res: Response): Promise<string> =>
    ((await res.json()) as { error: { code: string } }).error.code;

  it('requires the CSRF header on login', async () => {
    const res = await login('root', PASSWORD, { 'Content-Type': 'application/json' });
    expect(res.status).toBe(403);
    expect(await codeOf(res)).toBe('CSRF_HEADER_REQUIRED');
  });

  it('answers a wrong password and an unknown user the same way', async () => {
    for (const [u, p] of [
      ['root', 'wrong-password'],
      ['nobody', PASSWORD],
    ]) {
      const res = await login(u, p);
      expect(res.status).toBe(401);
      expect(await codeOf(res)).toBe('INVALID_CREDENTIALS');
    }
  });

  it('rejects a malformed body with VALIDATION_ERROR', async () => {
    const res = await fetch(`${ctx.base}/api/v1/auth/login`, {
      method: 'POST',
      headers: WRITE,
      body: JSON.stringify({ username: '' }),
    });
    expect(res.status).toBe(400);
    expect(await codeOf(res)).toBe('VALIDATION_ERROR');
  });

  it('logs in with a hardened session cookie and serves /auth/me', async () => {
    const res = await login(' ROOT ', PASSWORD);
    expect(res.status).toBe(204);
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toMatch(/^nfc_admin_session=/);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/Secure/i);
    expect(setCookie).toMatch(/SameSite=Strict/i);
    const meRes = await me(cookieOf(res));
    expect(meRes.status).toBe(200);
    expect(await meRes.json()).toEqual({ id: expect.any(String), username: 'root', display_name: 'Root' });
  });

  it('rejects /auth/me without a session or with a forged one', async () => {
    const none = await me();
    expect(none.status).toBe(401);
    expect(await codeOf(none)).toBe('UNAUTHORIZED');
    const forged = await me('nfc_admin_session=eyJhbGciOiJub25lIn0.eyJzdWIiOiJ4In0.');
    expect(forged.status).toBe(401);
  });

  it('a disabled admin loses the session at once and cannot log in again (INV-016)', async () => {
    const cookie = cookieOf(await login('victim', PASSWORD));
    expect((await me(cookie)).status).toBe(200);
    await pool.query("UPDATE admin_accounts SET status = 'disabled' WHERE username = 'victim'");
    expect((await me(cookie)).status).toBe(401);
    expect(await codeOf(await login('victim', PASSWORD))).toBe('INVALID_CREDENTIALS');
  });

  it('locks username + IP after 5 failures, even for the right password', async () => {
    for (let i = 0; i < 5; i++) expect((await login('locked', 'wrong-password')).status).toBe(401);
    const res = await login('locked', PASSWORD);
    expect(res.status).toBe(429);
    expect(await codeOf(res)).toBe('RATE_LIMITED');
    expect((await login('root', PASSWORD)).status).toBe(204);
  });

  it('logout clears the cookie', async () => {
    const res = await fetch(`${ctx.base}/api/v1/auth/logout`, { method: 'POST', headers: WRITE });
    expect(res.status).toBe(204);
    expect(res.headers.get('set-cookie') ?? '').toMatch(/^nfc_admin_session=;.*Expires=Thu, 01 Jan 1970/i);
  });

  it('keeps the health check public', async () => {
    expect((await fetch(`${ctx.base}/api/v1/system/health`)).status).toBe(200);
  });
});
