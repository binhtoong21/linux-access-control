import { Kysely } from 'kysely';
import { Pool } from 'pg';
import { createAdmin } from '../../src/identity/admin-accounts';
import { Database } from '../../src/infra/database/schema';
import { AppError } from '../../src/shared/http/app-error';
import { kyselyOn, resetDatabase, TEST_DATABASE_URL } from '../support/db';

(TEST_DATABASE_URL ? describe : describe.skip)('createAdmin', () => {
  let pool: Pool;
  let db: Kysely<Database>;

  beforeAll(async () => {
    pool = await resetDatabase(TEST_DATABASE_URL as string);
    db = kyselyOn(pool);
  });
  afterAll(() => pool.end());

  const codeOf = async (p: Promise<unknown>): Promise<string | undefined> => {
    try {
      await p;
      return undefined;
    } catch (err) {
      return err instanceof AppError ? err.code : 'not-an-AppError';
    }
  };

  it('bootstrap writes the admin and an admin.bootstrap audit row without the password hash', async () => {
    const admin = await createAdmin(db, { username: ' root ', displayName: 'Root', password: 'long-enough-pw' }, null);
    expect(admin).toMatchObject({ username: 'root', display_name: 'Root', status: 'active' });
    const row = await pool.query('SELECT password_hash FROM admin_accounts WHERE id = $1', [admin.id]);
    expect(row.rows[0].password_hash.startsWith('$argon2id$')).toBe(true);
    const audit = await pool.query('SELECT * FROM admin_audit_logs WHERE entity_id = $1', [admin.id]);
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]).toMatchObject({ admin_id: admin.id, action: 'admin.bootstrap', entity_type: 'admin' });
    expect(JSON.stringify(audit.rows[0].after)).not.toContain('argon2');
  });

  it('records the acting admin for a normal creation', async () => {
    const actor = await pool.query("SELECT id FROM admin_accounts WHERE username = 'root'");
    const admin = await createAdmin(db, { username: 'second', displayName: 'Second', password: 'long-enough-pw' }, actor.rows[0].id);
    const audit = await pool.query('SELECT admin_id, action FROM admin_audit_logs WHERE entity_id = $1', [admin.id]);
    expect(audit.rows[0]).toEqual({ admin_id: actor.rows[0].id, action: 'admin.create' });
  });

  it('rejects a duplicate username regardless of case and spaces', async () => {
    expect(await codeOf(createAdmin(db, { username: ' ROOT', displayName: 'x', password: 'long-enough-pw' }, null))).toBe('DUPLICATE');
  });

  it('rejects a too short password and writes nothing', async () => {
    expect(await codeOf(createAdmin(db, { username: 'shorty', displayName: 'x', password: 'short' }, null))).toBe('VALIDATION_ERROR');
    const rows = await pool.query("SELECT 1 FROM admin_accounts WHERE username = 'shorty'");
    expect(rows.rowCount).toBe(0);
  });
});
