import { randomUUID } from 'node:crypto';
import { ApiContext, auditActions, errorCode, outboxEvents, startSignedIn } from '../support/api';
import { TEST_DATABASE_URL } from '../support/db';

interface Summary {
  id: string;
  mqtt_identity: string;
  zone: { id: string; name: string } | null;
  status: string;
  connectivity: string;
  sync: { state: string; desired_version: number; acked_version: number };
  current_session: { user: { external_id: string; full_name: string } } | null;
  flags: string[];
}
interface Profile {
  os_username: string;
  is_default: boolean;
  status: string;
}
interface Detail extends Summary {
  machine_id: string;
  mac_address: string;
  key_version: number;
  last_apply_error: string | null;
  profiles: Profile[];
}

(TEST_DATABASE_URL ? describe : describe.skip)('workstations', () => {
  let api: ApiContext;
  let labA: string;
  let labB: string;
  let ws1: string;
  let ws2: string;
  let ws3: string;
  const missing = '00000000-0000-4000-8000-000000000000';

  const json = async <T>(res: Response, status: number): Promise<T> => {
    expect(res.status).toBe(status);
    return (await res.json()) as T;
  };
  const create = async (path: string, body: unknown): Promise<string> => (await json<{ id: string }>(await api.call('POST', path, body), 201)).id;
  const workstation = async (identity: string, mac: string, zoneId: string | null, status: string): Promise<string> => {
    const res = await api.pool.query(
      `INSERT INTO workstations (mqtt_identity, machine_id, mac_address, hostname, public_key, zone_id, status)
       VALUES ($1, $2, $3, $4, 'pk', $5, $6) RETURNING id`,
      [identity, `machine-${identity}`, mac, `host-${identity}`, zoneId, status],
    );
    return res.rows[0].id;
  };
  const names = async (query: string): Promise<string[]> =>
    (await json<Summary[]>(await api.call('GET', `/workstations${query}`), 200)).map((w) => w.mqtt_identity);

  beforeAll(async () => {
    api = await startSignedIn(TEST_DATABASE_URL as string);
    const user = await create('/users', { external_id: 'SV001', full_name: 'Nguyễn Văn A' });
    labA = await create('/zones', { name: 'Lab A', location: 'B1-201' });
    labB = await create('/zones', { name: 'Lab B', location: 'B1-202' });
    ws1 = await workstation('lab-a-01', '02:00:00:00:00:01', labA, 'enrolled');
    ws2 = await workstation('lab-a-02', '02:00:00:00:00:02', labA, 'enrolled');
    ws3 = await workstation('lab-x-01', '02:00:00:00:00:03', null, 'disabled');
    const q = (text: string, values: unknown[] = []) => api.pool.query(text, values);
    await q(`INSERT INTO workstation_statuses (workstation_id, connectivity, last_heartbeat_at, trust_state) VALUES ($1, 'online', now(), 'Fresh')`, [ws1]);
    await q(
      `INSERT INTO workstation_statuses (workstation_id, connectivity, last_heartbeat_at, trust_state, last_apply_error)
       VALUES ($1, 'online', now(), 'Fresh', 'schema_invalid')`,
      [ws2],
    );
    await q(`INSERT INTO sync_states (workstation_id, desired_version, acked_version) VALUES ($1, 13, 13)`, [ws1]);
    await q(
      `INSERT INTO sync_states (workstation_id, desired_version, acked_version, desired_updated_at) VALUES ($1, 5, 4, now() - interval '20 minutes')`,
      [ws2],
    );
    await q(
      `INSERT INTO sessions (id, decision_id, user_id, workstation_id, os_username, boot_id, decided_at, started_at, expires_at)
       VALUES ($1, $2, $3, $4, 'student', 'boot-1', now() - interval '2 hours', now() - interval '2 hours', now() - interval '30 minutes')`,
      [randomUUID(), randomUUID(), user, ws1],
    );
    await q(`INSERT INTO ingest_rejects (workstation_id, raw_record, error) VALUES ($1, '{}', 'unknown event_type')`, [ws2]);
    await q(`INSERT INTO workstation_alerts (entry_id, workstation_id, kind, occurred_at) VALUES ($1, $2, 'edge_db_recovered', now())`, [randomUUID(), ws2]);
    await q(
      `INSERT INTO workstation_profiles (workstation_id, os_username, display_name, is_default)
       VALUES ($1, 'student', 'Sinh viên', true), ($1, 'exam', 'Thi', false)`,
      [ws1],
    );
    await create('/schedules', {
      name: 'Thực hành CSDL',
      subject: { type: 'user', id: user },
      target: { type: 'zone', id: labA },
      valid_from: '2026-09-01',
      days_of_week: ['MONDAY'],
      start_time: '07:30',
      end_time: '11:30',
    });
  });
  afterAll(async () => api.close());

  it('lists workstations with zone, connectivity, sync, current session and flags', async () => {
    const list = await json<Summary[]>(await api.call('GET', '/workstations'), 200);
    expect(list.map((w) => w.mqtt_identity)).toEqual(['lab-a-01', 'lab-a-02', 'lab-x-01']);
    expect(list[0]).toMatchObject({
      id: ws1,
      hostname: 'host-lab-a-01',
      zone: { id: labA, name: 'Lab A' },
      status: 'enrolled',
      connectivity: 'online',
      trust_state: 'Fresh',
      clock_skew_detected: false,
      sync: { state: 'in_sync', desired_version: 13, acked_version: 13 },
      current_session: { user: { external_id: 'SV001', full_name: 'Nguyễn Văn A' } },
      flags: ['overdue_session'],
    });
    expect(list[1]).toMatchObject({
      sync: { state: 'stuck', desired_version: 5, acked_version: 4 },
      current_session: null,
      flags: ['stuck_sync', 'apply_error', 'missing_profile', 'ingest_rejects', 'security_alert'],
    });
    expect(list[2]).toMatchObject({
      zone: null,
      status: 'disabled',
      connectivity: 'offline',
      last_heartbeat_at: null,
      trust_state: null,
      sync: { state: 'in_sync', desired_version: 0, acked_version: 0 },
      current_session: null,
      flags: [],
    });
  });

  it('filters by zone, status, connectivity and sync state (FR-042)', async () => {
    expect(await names(`?zone_id=${labA}`)).toEqual(['lab-a-01', 'lab-a-02']);
    expect(await names(`?zone_id=${labB}`)).toEqual([]);
    expect(await names('?status=disabled')).toEqual(['lab-x-01']);
    expect(await names('?connectivity=online')).toEqual(['lab-a-01', 'lab-a-02']);
    expect(await names('?connectivity=offline')).toEqual(['lab-x-01']);
    expect(await names('?sync=stuck')).toEqual(['lab-a-02']);
    expect(await names('?sync=in_sync')).toEqual(['lab-a-01', 'lab-x-01']);
    expect(await names('?sync=pending')).toEqual([]);
    expect(await names(`?zone_id=${labA}&sync=in_sync&connectivity=online`)).toEqual(['lab-a-01']);
    for (const bad of ['?sync=nope', '?zone_id=nope', '?status=gone', '?connectivity=maybe']) {
      expect((await api.call('GET', `/workstations${bad}`)).status).toBe(400);
    }
  });

  it('returns the detail of a workstation with its profiles', async () => {
    const detail = await json<Detail>(await api.call('GET', `/workstations/${ws1}`), 200);
    expect(detail).toMatchObject({
      mqtt_identity: 'lab-a-01',
      machine_id: 'machine-lab-a-01',
      mac_address: '02:00:00:00:00:01',
      key_version: 1,
      last_apply_error: null,
      flags: ['overdue_session'],
    });
    expect(detail.profiles.map((p) => [p.os_username, p.is_default, p.status])).toEqual([
      ['exam', false, 'enabled'],
      ['student', true, 'enabled'],
    ]);
    expect((await json<Detail>(await api.call('GET', `/workstations/${ws2}`), 200)).last_apply_error).toBe('schema_invalid');
  });

  it('moves a workstation between zones and emits WorkstationZoneChanged only on a real change', async () => {
    const moved = await json<Detail>(await api.call('PATCH', `/workstations/${ws3}`, { zone_id: labB }), 200);
    expect(moved.zone).toEqual({ id: labB, name: 'Lab B' });
    await json<Detail>(await api.call('PATCH', `/workstations/${ws3}`, { zone_id: labB }), 200);
    await json<Detail>(await api.call('PATCH', `/workstations/${ws3}`, {}), 200);
    const removed = await json<Detail>(await api.call('PATCH', `/workstations/${ws3}`, { zone_id: null }), 200);
    expect(removed.zone).toBeNull();
    expect(await outboxEvents(api.pool, ws3)).toEqual([
      { event_type: 'WorkstationZoneChanged', payload: { before: { zone_id: null }, after: { zone_id: labB } } },
      { event_type: 'WorkstationZoneChanged', payload: { before: { zone_id: labB }, after: { zone_id: null } } },
    ]);
    expect(await auditActions(api.pool, ws3)).toEqual(['workstation.update', 'workstation.update']);
    const unknown = await api.call('PATCH', `/workstations/${ws3}`, { zone_id: missing });
    expect(unknown.status).toBe(400);
    expect(await errorCode(unknown)).toBe('VALIDATION_ERROR');
    expect((await api.call('PATCH', `/workstations/${ws3}`, { zone_id: 'nope' })).status).toBe(400);
  });

  it('configures profiles: one default per workstation, enable/disable, events only on real changes (FR-007)', async () => {
    const path = `/workstations/${ws1}/profiles`;
    const exam = await json<Profile>(await api.call('PATCH', `${path}/exam`, { is_default: true }), 200);
    expect(exam).toMatchObject({ os_username: 'exam', is_default: true, status: 'enabled' });
    await json<Profile>(await api.call('PATCH', `${path}/exam`, { is_default: true }), 200);
    await json<Profile>(await api.call('PATCH', `${path}/exam`, {}), 200);
    const profiles = await json<Profile[]>(await api.call('GET', path), 200);
    expect(profiles.map((p) => [p.os_username, p.is_default])).toEqual([
      ['exam', true],
      ['student', false],
    ]);
    expect((await json<Detail>(await api.call('GET', `/workstations/${ws1}`), 200)).flags).toEqual(['overdue_session']);
    const disabled = await json<Profile>(await api.call('PATCH', `${path}/exam`, { status: 'disabled' }), 200);
    expect(disabled.status).toBe('disabled');
    // The schedule on Lab A uses the default profile, which is now disabled.
    expect((await json<Detail>(await api.call('GET', `/workstations/${ws1}`), 200)).flags).toEqual(['overdue_session', 'missing_profile']);
    expect(await outboxEvents(api.pool, ws1)).toEqual([
      { event_type: 'WorkstationProfileConfigured', payload: { os_username: 'exam', before: { is_default: false }, after: { is_default: true } } },
      { event_type: 'WorkstationProfileConfigured', payload: { os_username: 'exam', before: { status: 'enabled' }, after: { status: 'disabled' } } },
    ]);
    expect(await auditActions(api.pool, ws1)).toEqual(['workstation.profile_update', 'workstation.profile_update']);
    for (const bad of [{ status: 'gone' }, { is_default: 'yes' }, { display_name: 'X' }]) {
      expect((await api.call('PATCH', `${path}/exam`, bad)).status).toBe(400);
    }
  });

  it('returns 404 for an unknown workstation or profile', async () => {
    for (const [method, path, body] of [
      ['GET', `/workstations/${missing}`, undefined],
      ['PATCH', `/workstations/${missing}`, { zone_id: null }],
      ['PATCH', `/workstations/${missing}`, {}],
      ['GET', `/workstations/${missing}/profiles`, undefined],
      ['PATCH', `/workstations/${missing}/profiles/student`, { status: 'disabled' }],
      ['PATCH', `/workstations/${ws1}/profiles/nobody`, { status: 'disabled' }],
      ['PATCH', `/workstations/${ws1}/profiles/Not-A-Name`, { status: 'disabled' }],
    ] as const) {
      const res = await api.call(method, path, body);
      expect([path, res.status]).toEqual([path, 404]);
      expect(await errorCode(res)).toBe('NOT_FOUND');
    }
  });
});
