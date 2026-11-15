import { randomUUID } from 'node:crypto';
import { SessionInferenceService } from '../../src/operations/session-inference.service';
import { ApiContext, startSignedIn } from '../support/api';
import { TEST_DATABASE_URL } from '../support/db';

const OLD_BOOT = '9f2c8d14-5b1e-4c33-9a70-0d6f2e8b1c47';
const NEW_BOOT = '11111111-2222-4333-8444-555555555555';

(TEST_DATABASE_URL ? describe : describe.skip)('inferring sessions lost to a reboot', () => {
  let api: ApiContext;
  let inference: SessionInferenceService;
  let user: string;
  let n = 0;

  const q = async (text: string, values: unknown[] = []) => (await api.pool.query(text, values)).rows;
  /** A workstation whose status says it booted `boot`, draining since `drainingMinutes` ago (null = not draining). */
  const workstation = async (boot: string, drainingMinutes: number | null): Promise<string> => {
    n += 1;
    const hex = n.toString(16).padStart(2, '0');
    const id = (
      await q(
        `INSERT INTO workstations (mqtt_identity, machine_id, mac_address, hostname, public_key)
         VALUES ($1, $1, $2, $1, 'pk') RETURNING id`,
        [`lab-a-${hex}`, `02:00:00:00:00:${hex}`],
      )
    )[0].id;
    await q(
      `INSERT INTO workstation_statuses (workstation_id, connectivity, last_heartbeat_at, boot_id, reconcile_state, draining_started_at)
       VALUES ($1, 'online', now(), $2, $3, CASE WHEN $4::int IS NULL THEN NULL ELSE now() - $4::int * interval '1 minute' END)`,
      [id, boot, drainingMinutes === null ? 'Idle' : 'Draining', drainingMinutes],
    );
    return id;
  };
  /** An active session started `startedMinutes` ago that expires `expiresInMinutes` from now (negative = in the past). */
  const session = async (ws: string, boot: string, startedMinutes: number, expiresInMinutes: number): Promise<string> => {
    const id = randomUUID();
    await q(
      `INSERT INTO sessions (id, decision_id, user_id, workstation_id, os_username, boot_id, decided_at, started_at, expires_at)
       VALUES ($1, $2, $3, $4, 'student', $5, now() - $6::int * interval '1 minute', now() - $6::int * interval '1 minute',
               now() + $7::int * interval '1 minute')`,
      [id, randomUUID(), user, ws, boot, startedMinutes, expiresInMinutes],
    );
    return id;
  };
  const row = async (id: string) =>
    (
      await q(
        `SELECT s.status, s.end_reason, s.end_source,
                round(extract(epoch from s.ended_at - st_ref.ref))::int AS ended_vs_ref
         FROM sessions s
         LEFT JOIN LATERAL (SELECT coalesce(min(draining_started_at), now()) AS ref FROM workstation_statuses) st_ref ON true
         WHERE s.id = $1`,
        [id],
      )
    )[0];
  const status = async (ws: string) =>
    (await q('SELECT reconcile_state, draining_started_at IS NULL AS cleared FROM workstation_statuses WHERE workstation_id = $1', [ws]))[0];
  const ended = async (id: string): Promise<Date | null> => (await q('SELECT ended_at FROM sessions WHERE id = $1', [id]))[0].ended_at;

  beforeAll(async () => {
    api = await startSignedIn(TEST_DATABASE_URL as string);
    inference = api.ctx.app.get(SessionInferenceService, { strict: false });
    user = ((await (await api.call('POST', '/users', { external_id: 'SV001', full_name: 'Nguyễn Văn A' })).json()) as { id: string }).id;
  });
  afterAll(async () => api.close());

  it('closes old-boot sessions of workstations draining for more than 5 minutes and leaves everything else', async () => {
    const drained = await workstation(NEW_BOOT, 6);
    const lost = await session(drained, OLD_BOOT, 60, 120);
    const drainedExpired = await workstation(NEW_BOOT, 30);
    const expiredBefore = await session(drainedExpired, OLD_BOOT, 120, -60);
    const recent = await workstation(NEW_BOOT, 1);
    const waiting = await session(recent, OLD_BOOT, 60, 120);
    const sameBoot = await workstation(NEW_BOOT, 10);
    const current = await session(sameBoot, NEW_BOOT, 2, 120);
    const idle = await workstation(OLD_BOOT, null);
    const running = await session(idle, OLD_BOOT, 30, 120);

    const drainingStartedAt = (await q('SELECT draining_started_at FROM workstation_statuses WHERE workstation_id = $1', [drained]))[0].draining_started_at;
    const expiresAt = (await q('SELECT expires_at FROM sessions WHERE id = $1', [expiredBefore]))[0].expires_at;

    expect(await inference.inferAbandoned()).toEqual(['lab-a-01', 'lab-a-02', 'lab-a-04']);

    expect(await row(lost)).toMatchObject({ status: 'abandoned', end_reason: 'workstation_rebooted', end_source: 'inferred' });
    expect((await ended(lost))?.getTime()).toBe(new Date(drainingStartedAt).getTime());
    expect(await row(expiredBefore)).toMatchObject({ status: 'abandoned', end_source: 'inferred' });
    expect((await ended(expiredBefore))?.getTime()).toBe(new Date(expiresAt).getTime());
    for (const id of [waiting, current, running]) expect((await row(id)).status).toBe('active');

    for (const ws of [drained, drainedExpired, sameBoot]) expect(await status(ws)).toEqual({ reconcile_state: 'Idle', cleared: true });
    expect(await status(recent)).toEqual({ reconcile_state: 'Draining', cleared: false });
    expect(await status(idle)).toEqual({ reconcile_state: 'Idle', cleared: true });

    // Nothing left to do on the next run.
    expect(await inference.inferAbandoned()).toEqual([]);
  });

  it('never moves the end before the start of the session', async () => {
    const ws = await workstation(NEW_BOOT, 10);
    // Started after the new boot was seen (clock trouble): the end is clamped to the start (INV-007).
    const late = await session(ws, OLD_BOOT, 5, 120);
    expect(await inference.inferAbandoned()).toEqual(['lab-a-06']);
    const r = (await q('SELECT ended_at, started_at FROM sessions WHERE id = $1', [late]))[0];
    expect(new Date(r.ended_at).getTime()).toBe(new Date(r.started_at).getTime());
  });
});
