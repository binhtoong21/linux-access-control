import { ApiContext, auditActions, errorCode, outboxEvents, startSignedIn } from '../support/api';
import { TEST_DATABASE_URL } from '../support/db';

interface Zone {
  id: string;
  name: string;
  location: string;
  description: string | null;
  workstation_count: number;
}

(TEST_DATABASE_URL ? describe : describe.skip)('zones', () => {
  let api: ApiContext;
  let labA: Zone;
  let labB: Zone;
  let workstationId: string;
  const missing = '00000000-0000-4000-8000-000000000000';

  const json = async <T>(res: Response, status: number): Promise<T> => {
    expect(res.status).toBe(status);
    return (await res.json()) as T;
  };

  beforeAll(async () => {
    api = await startSignedIn(TEST_DATABASE_URL as string);
  });
  afterAll(async () => api.close());

  it('creates zones with audit and rejects duplicate, blank or incomplete input', async () => {
    labA = await json<Zone>(await api.call('POST', '/zones', { name: '  Lab A ', location: ' B1-201 ', description: 'Tầng 2' }), 201);
    expect(labA).toMatchObject({ name: 'Lab A', location: 'B1-201', description: 'Tầng 2', workstation_count: 0 });
    labB = await json<Zone>(await api.call('POST', '/zones', { name: 'lab b', location: 'B1-202' }), 201);
    expect(labB.description).toBeNull();
    expect(await auditActions(api.pool, labA.id)).toEqual(['zone.create']);
    const dup = await api.call('POST', '/zones', { name: 'LAB A', location: 'B9' });
    expect(dup.status).toBe(409);
    expect(await errorCode(dup)).toBe('DUPLICATE');
    for (const bad of [{ name: '   ', location: 'B1' }, { name: 'Lab X' }, { name: 'Lab X', location: '  ' }]) {
      expect((await api.call('POST', '/zones', bad)).status).toBe(400);
    }
  });

  it('updates a zone, audits only real changes and refuses a name taken by another zone', async () => {
    const change = { name: 'Lab B', location: 'B1-203', description: null };
    expect(await json<Zone>(await api.call('PATCH', `/zones/${labB.id}`, change), 200)).toMatchObject(change);
    expect(await json<Zone>(await api.call('PATCH', `/zones/${labB.id}`, change), 200)).toMatchObject(change);
    expect(await auditActions(api.pool, labB.id)).toEqual(['zone.create', 'zone.update']);
    const clash = await api.call('PATCH', `/zones/${labB.id}`, { name: 'lab a' });
    expect(clash.status).toBe(409);
    expect(await errorCode(clash)).toBe('DUPLICATE');
    expect(await outboxEvents(api.pool, labB.id)).toEqual([]);
  });

  it('lists zones by name with their workstation counts', async () => {
    const ws = await api.pool.query(
      `INSERT INTO workstations (mqtt_identity, machine_id, mac_address, hostname, public_key, zone_id)
       VALUES ('lab-a-01', 'machine-01', '02:00:00:00:00:01', 'lab-a-01', 'pk', $1) RETURNING id`,
      [labA.id],
    );
    workstationId = ws.rows[0].id;
    const list = await json<Zone[]>(await api.call('GET', '/zones'), 200);
    expect(list.map((z) => [z.name, z.workstation_count])).toEqual([['Lab A', 1], ['Lab B', 0]]);
  });

  it('refuses to delete a zone used by a schedule (BR-017)', async () => {
    const user = await json<{ id: string }>(await api.call('POST', '/users', { external_id: 'SV001', full_name: 'SV001' }), 201);
    const schedule = await api.pool.query(
      `INSERT INTO schedules (name, subject_type, subject_user_id, target_type, target_zone_id, valid_from, days_of_week, start_minute, end_minute)
       VALUES ('Thực hành CSDL', 'user', $1, 'zone', $2, '2026-11-01', ARRAY['MONDAY'], 420, 600) RETURNING id`,
      [user.id, labB.id],
    );
    const res = await api.call('DELETE', `/zones/${labB.id}`);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: {
        code: 'REFERENCED_BY_SCHEDULE',
        message: 'The zone is used by schedules',
        details: [{ schedule_id: schedule.rows[0].id, name: 'Thực hành CSDL' }],
      },
    });
    expect((await json<Zone[]>(await api.call('GET', '/zones'), 200)).map((z) => z.name)).toContain('Lab B');
  });

  it('deletes a zone, keeps its workstations without a zone and emits ZoneDeleted (BR-015)', async () => {
    expect((await api.call('DELETE', `/zones/${labA.id}`)).status).toBe(204);
    const ws = await api.pool.query('SELECT zone_id FROM workstations WHERE id = $1', [workstationId]);
    expect(ws.rows).toEqual([{ zone_id: null }]);
    expect(await outboxEvents(api.pool, labA.id)).toEqual([{ event_type: 'ZoneDeleted', payload: { workstation_ids: [workstationId] } }]);
    expect(await auditActions(api.pool, labA.id)).toEqual(['zone.create', 'zone.delete']);
  });

  it('deletes an empty zone without an event', async () => {
    const labC = await json<Zone>(await api.call('POST', '/zones', { name: 'Lab C', location: 'B2-101' }), 201);
    expect((await api.call('DELETE', `/zones/${labC.id}`)).status).toBe(204);
    expect(await outboxEvents(api.pool, labC.id)).toEqual([]);
    expect((await json<Zone[]>(await api.call('GET', '/zones'), 200)).map((z) => z.name)).toEqual(['Lab B']);
  });

  it('returns 404 for an unknown zone', async () => {
    for (const [method, path, body] of [
      ['PATCH', `/zones/${missing}`, { name: 'X' }],
      ['DELETE', `/zones/${missing}`, undefined],
    ] as const) {
      const res = await api.call(method, path, body);
      expect(res.status).toBe(404);
      expect(await errorCode(res)).toBe('NOT_FOUND');
    }
  });
});
