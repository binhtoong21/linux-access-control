import path from 'node:path';
import { Pool } from 'pg';
import { migrateDown, migrateUp, migrationStatus } from '../../src/infra/database/migrator';

// Needs a disposable database: TEST_DATABASE_URL (its public schema is wiped). Skipped when unset.
const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;
const DIR = path.resolve(__dirname, '../../migrations');
const ALL = [
  '20261111_093000_init_identity_and_device',
  '20261111_093100_init_scheduling_and_distribution',
  '20261111_093200_init_operations_and_triggers',
];

d('baseline migrations', () => {
  let pool: Pool;

  const q = (sql: string, params: unknown[] = []) => pool.query(sql, params);
  const pgCode = async (p: Promise<unknown>): Promise<string | undefined> => {
    try {
      await p;
      return undefined;
    } catch (err) {
      return (err as { code?: string }).code;
    }
  };

  async function user(externalId: string): Promise<string> {
    const r = await q("INSERT INTO users (external_id, full_name) VALUES ($1, 'Test User') RETURNING id", [externalId]);
    return r.rows[0].id;
  }
  async function workstation(n: number): Promise<string> {
    const r = await q(
      `INSERT INTO workstations (mqtt_identity, machine_id, mac_address, hostname, public_key)
       VALUES ($1, $2, $3, $4, 'pk') RETURNING id`,
      [`ws-${n}`, `machine-${n}`, `00:11:22:33:44:${String(n).padStart(2, '0')}`, `host-${n}`],
    );
    return r.rows[0].id;
  }
  async function session(ws: string, u: string, ended: boolean, endSource = 'inferred'): Promise<string> {
    const r = await q(
      `INSERT INTO sessions (id, decision_id, user_id, workstation_id, os_username, boot_id,
         decided_at, started_at, expires_at, status, ended_at, end_reason, end_source)
       VALUES (gen_random_uuid(), gen_random_uuid(), $1, $2, 'student', 'boot-1',
         now(), now(), now() + interval '1 hour', $3, $4, $5, $6) RETURNING id`,
      ended
        ? [u, ws, 'abandoned', new Date(Date.now() + 1000), 'workstation_rebooted', endSource]
        : [u, ws, 'active', null, null, null],
    );
    return r.rows[0].id;
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    await q('DROP SCHEMA public CASCADE');
    await q('CREATE SCHEMA public');
  });
  afterAll(() => pool.end());

  it('applies all migrations once, rolls them back and re-applies cleanly', async () => {
    expect(await migrateUp(pool, DIR)).toEqual(ALL);
    expect(await migrateUp(pool, DIR)).toEqual([]);
    expect(await migrateDown(pool, DIR, 3)).toEqual([...ALL].reverse());
    expect((await q("SELECT to_regclass('public.users') AS t")).rows[0].t).toBeNull();
    expect(await migrateUp(pool, DIR)).toEqual(ALL);
    expect(await migrationStatus(pool, DIR)).toEqual({ applied: ALL, pending: [] });
  });

  describe('constraints', () => {
    it('workstations: mqtt_identity cannot carry MQTT topic characters (chk_workstations_mqtt_identity)', async () => {
      const code = await pgCode(
        q(
          `INSERT INTO workstations (mqtt_identity, machine_id, mac_address, hostname, public_key)
           VALUES ('ws/#', 'machine-bad', '00:11:22:33:44:99', 'host-bad', 'pk')`,
        ),
      );
      expect(code).toBe('23514');
    });
    it('cards: unbound card cannot have an owner (chk_cards_owner_unbound)', async () => {
      const u = await user('SV-CARD');
      const code = await pgCode(
        q(
          `INSERT INTO cards (uid_encrypted, uid_iv, uid_auth_tag, encryption_key_id, uid_index, uid_length, owner_id, status)
           VALUES ('\\x00', $1, $2, 'k1', repeat('a', 64), 4, $3, 'unbound')`,
          [Buffer.alloc(12), Buffer.alloc(16), u],
        ),
      );
      expect(code).toBe('23514');
    });

    it('users: external_id unique after trimming (uq_users_external_id)', async () => {
      await user('SV001');
      expect(await pgCode(user(' SV001 '))).toBe('23505');
    });

    it('workstation_profiles: at most one default per workstation (uq_ws_default_profile)', async () => {
      const ws = await workstation(1);
      const ins = (name: string) =>
        q("INSERT INTO workstation_profiles (workstation_id, os_username, display_name, is_default) VALUES ($1, $2, $2, true)", [ws, name]);
      await ins('student');
      expect(await pgCode(ins('guest'))).toBe('23505');
    });

    it('schedules: subject must match subject_type (chk_sched_subject_xor)', async () => {
      const ws = await workstation(2);
      const code = await pgCode(
        q(
          `INSERT INTO schedules (name, subject_type, target_type, target_workstation_id, valid_from, days_of_week, start_minute, end_minute)
           VALUES ('x', 'user', 'workstation', $1, current_date, ARRAY['MONDAY'], 480, 600)`,
          [ws],
        ),
      );
      expect(code).toBe('23514');
    });

    it('sessions: one active session per workstation (uq_sessions_active_ws)', async () => {
      const ws = await workstation(3);
      const u = await user('SV-SESS');
      await session(ws, u, false);
      expect(await pgCode(session(ws, u, false))).toBe('23505');
    });
  });

  describe('triggers', () => {
    it('audit_logs is append-only', async () => {
      const ws = await workstation(4);
      await q(
        `INSERT INTO audit_logs (entry_id, occurred_at, workstation_id, outcome, reason, workstation_snapshot)
         VALUES (gen_random_uuid(), now(), $1, 'denied', 'unknown_card', '{}')`,
        [ws],
      );
      expect(await pgCode(q("UPDATE audit_logs SET reason = 'x'"))).toBe('23001');
      expect(await pgCode(q('DELETE FROM audit_logs'))).toBe('23001');
    });

    it('admin_audit_logs is append-only', async () => {
      const r = await q("INSERT INTO admin_accounts (username, display_name, password_hash) VALUES ('root', 'Root', 'h') RETURNING id");
      await q("INSERT INTO admin_audit_logs (admin_id, action, entity_type) VALUES ($1, 'admin.create', 'admin')", [r.rows[0].id]);
      expect(await pgCode(q("UPDATE admin_audit_logs SET action = 'x'"))).toBe('23001');
      expect(await pgCode(q('DELETE FROM admin_audit_logs'))).toBe('23001');
    });

    it('sessions: active may end; inferred end may become reported once; then immutable', async () => {
      const ws = await workstation(5);
      const u = await user('SV-TRIG');
      const active = await session(ws, u, false);
      await q(
        "UPDATE sessions SET status = 'completed', ended_at = now() + interval '1 second', end_reason = 'user_logout', end_source = 'reported' WHERE id = $1",
        [active],
      );
      const inferred = await session(ws, u, true, 'inferred');
      await q("UPDATE sessions SET end_source = 'reported', end_reason = 'user_logout' WHERE id = $1", [inferred]);
      expect(await pgCode(q("UPDATE sessions SET end_reason = 'superseded' WHERE id = $1", [inferred]))).toBe('23001');
      expect(await pgCode(q('DELETE FROM sessions WHERE id = $1', [inferred]))).toBe('23001');
    });
  });
});
