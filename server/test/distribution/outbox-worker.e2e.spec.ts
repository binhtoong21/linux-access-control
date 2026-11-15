import { OutboxWorker } from '../../src/distribution/outbox-worker';
import { SnapshotService } from '../../src/distribution/snapshot.service';
import { ApiContext, startSignedIn } from '../support/api';
import { kyselyOn, TEST_DATABASE_URL } from '../support/db';

interface Health {
  status: string;
  outbox_backlog: number | null;
  warnings: string[];
}

(TEST_DATABASE_URL ? describe : describe.skip)('outbox worker', () => {
  let api: ApiContext;
  let worker: OutboxWorker;
  let card: string;
  let schedule: string;
  let ws1: string;

  const json = async <T>(res: Response, status: number): Promise<T> => {
    expect(res.status).toBe(status);
    return (await res.json()) as T;
  };
  const create = async (path: string, body: unknown): Promise<string> => (await json<{ id: string }>(await api.call('POST', path, body), 201)).id;
  const ok = async (method: string, path: string, body?: unknown): Promise<void> => {
    await json(await api.call(method, path, body), 200);
  };
  const health = async (): Promise<Health> => json<Health>(await api.call('GET', '/system/health'), 200);
  const count = async (text: string): Promise<number> => (await api.pool.query(`SELECT count(*)::int AS n FROM ${text}`)).rows[0].n;
  const pending = (): Promise<number> => count("server_outbox WHERE status = 'pending'");
  const issued = (run: { results: { mqtt_identity: string; version: number | null }[] }): [string, number | null][] =>
    run.results.map((r) => [r.mqtt_identity, r.version]);

  beforeAll(async () => {
    api = await startSignedIn(TEST_DATABASE_URL as string);
    worker = api.ctx.app.get(OutboxWorker, { strict: false });
    const user = await create('/users', { external_id: 'SV001', full_name: 'Nguyễn Văn A' });
    card = await create('/cards', { uid: '1F0820CF', user_id: user });
    const zone = await create('/zones', { name: 'Lab A', location: 'B1-201' });
    const res = await api.pool.query(
      `INSERT INTO workstations (mqtt_identity, machine_id, mac_address, hostname, public_key, zone_id)
       VALUES ('lab-a-01', 'machine-01', '02:00:00:00:00:01', 'host-01', 'pk', $1) RETURNING id`,
      [zone],
    );
    ws1 = res.rows[0].id;
    await api.pool.query("INSERT INTO workstation_profiles (workstation_id, os_username, display_name, is_default) VALUES ($1, 'student', 'Sinh viên', true)", [ws1]);
    schedule = await create('/schedules', {
      name: 'Thực hành CSDL',
      subject: { type: 'user', id: user },
      target: { type: 'zone', id: zone },
      valid_from: '2026-09-01',
      days_of_week: ['MONDAY'],
      start_time: '07:30',
      end_time: '11:30',
    });
  });
  afterAll(async () => api.close());

  it('starts no timer under SNAPSHOT_WORKER=off: events wait and health shows the backlog', async () => {
    const backlog = await pending();
    expect(backlog).toBeGreaterThan(0);
    expect(await count('snapshots')).toBe(0);
    expect(await health()).toMatchObject({ status: 'ok', outbox_backlog: backlog, warnings: [] });
  });

  it('turns the pending events into one snapshot version and marks them processed', async () => {
    const backlog = await pending();
    const run = await worker.runOnce();
    expect(run.events).toBe(backlog);
    expect(issued(run)).toEqual([['lab-a-01', 1]]);
    expect(await pending()).toBe(0);
    expect(await count("server_outbox WHERE status = 'processed' AND processed_at IS NOT NULL")).toBe(backlog);
    expect((await health()).outbox_backlog).toBe(0);
    const list = await json<{ mqtt_identity: string; sync: unknown }[]>(await api.call('GET', '/workstations'), 200);
    expect(list[0].sync).toEqual({ state: 'pending', desired_version: 1, acked_version: 0 });
  });

  it('does nothing without pending events', async () => {
    expect(await worker.runOnce()).toEqual({ events: 0, results: [] });
    expect(await count('snapshots')).toBe(1);
  });

  it('coalesces several events into one reconcile and issues a version only when the content changed', async () => {
    await ok('POST', `/cards/${card}/disable`);
    await ok('POST', `/cards/${card}/enable`);
    await ok('POST', `/cards/${card}/disable`);
    const changed = await worker.runOnce();
    expect([changed.events, issued(changed)]).toEqual([3, [['lab-a-01', 2]]]);

    await ok('POST', `/schedules/${schedule}/disable`);
    await ok('POST', `/schedules/${schedule}/enable`);
    const same = await worker.runOnce();
    expect([same.events, issued(same)]).toEqual([2, [['lab-a-01', null]]]);
    expect(await count('snapshots')).toBe(2);
  });

  it('marks the events processed and raises a health warning when a snapshot cannot be built', async () => {
    const tag = (await api.pool.query('SELECT uid_auth_tag FROM cards WHERE id = $1', [card])).rows[0].uid_auth_tag;
    await api.pool.query("UPDATE cards SET uid_auth_tag = decode(repeat('00', 16), 'hex') WHERE id = $1", [card]);
    await ok('POST', `/cards/${card}/enable`);
    const run = await worker.runOnce();
    expect(run.events).toBe(1);
    expect(run.results.map((r) => [r.mqtt_identity, r.version, typeof r.error])).toEqual([['lab-a-01', null, 'string']]);
    expect(await pending()).toBe(0);
    expect(worker.failures()).toEqual(['lab-a-01']);
    expect(await health()).toMatchObject({ status: 'ok', warnings: ['snapshot_build_failed'] });

    await api.pool.query('UPDATE cards SET uid_auth_tag = $2 WHERE id = $1', [card, tag]);
    expect((await worker.reconcileNow()).map((r) => [r.mqtt_identity, r.version])).toEqual([['lab-a-01', 3]]);
    expect(worker.failures()).toEqual([]);
    expect((await health()).warnings).toEqual([]);
  });

  it('with timers on, reconciles at startup, drains the outbox and stops cleanly', async () => {
    await api.pool.query("INSERT INTO workstation_profiles (workstation_id, os_username, display_name) VALUES ($1, 'exam', 'Thi')", [ws1]);
    await ok('POST', `/schedules/${schedule}/disable`);
    expect(await pending()).toBe(1);
    const live = new OutboxWorker(kyselyOn(api.pool), api.ctx.app.get(SnapshotService, { strict: false }), { snapshotWorkerEnabled: true });
    live.onApplicationBootstrap();
    await live.onApplicationShutdown();
    expect(await pending()).toBe(0);
    expect((await api.pool.query('SELECT desired_version::int AS v FROM sync_states WHERE workstation_id = $1', [ws1])).rows[0].v).toBe(4);
    // Stopped: a later event stays pending.
    await ok('POST', `/schedules/${schedule}/enable`);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(await pending()).toBe(1);
  });
});
