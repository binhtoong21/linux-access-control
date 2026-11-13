import { ApiContext, auditActions, errorCode, outboxEvents, startSignedIn } from '../support/api';
import { TEST_DATABASE_URL } from '../support/db';

interface Group {
  id: string;
  name: string;
  description: string | null;
  member_count: number;
}

(TEST_DATABASE_URL ? describe : describe.skip)('groups', () => {
  let api: ApiContext;
  let k65: Group;
  let attt: Group;
  const u: string[] = [];
  const missing = '00000000-0000-4000-8000-000000000000';

  const json = async <T>(res: Response, status: number): Promise<T> => {
    expect(res.status).toBe(status);
    return (await res.json()) as T;
  };

  beforeAll(async () => {
    api = await startSignedIn(TEST_DATABASE_URL as string);
    for (const id of ['SV001', 'SV002', 'SV003', 'SV004']) {
      u.push((await json<{ id: string }>(await api.call('POST', '/users', { external_id: id, full_name: id }), 201)).id);
    }
  });
  afterAll(async () => api.close());

  it('creates groups with audit and rejects duplicate or blank names', async () => {
    k65 = await json<Group>(await api.call('POST', '/groups', { name: '  CNTT-K65 ', description: 'Khóa 65' }), 201);
    expect(k65).toMatchObject({ name: 'CNTT-K65', description: 'Khóa 65', member_count: 0 });
    attt = await json<Group>(await api.call('POST', '/groups', { name: 'attt' }), 201);
    expect(attt.description).toBeNull();
    expect(await auditActions(api.pool, k65.id)).toEqual(['group.create']);
    const dup = await api.call('POST', '/groups', { name: 'cntt-k65' });
    expect(dup.status).toBe(409);
    expect(await errorCode(dup)).toBe('DUPLICATE');
    expect((await api.call('POST', '/groups', { name: '   ' })).status).toBe(400);
  });

  it('renames, clears the description and refuses a name taken by another group', async () => {
    const renamed = await json<Group>(await api.call('PATCH', `/groups/${attt.id}`, { name: 'ATTT-K66', description: null }), 200);
    expect(renamed).toMatchObject({ name: 'ATTT-K66', description: null });
    const clash = await api.call('PATCH', `/groups/${attt.id}`, { name: 'Cntt-K65' });
    expect(clash.status).toBe(409);
    expect(await errorCode(clash)).toBe('DUPLICATE');
    expect(await outboxEvents(api.pool, attt.id)).toEqual([]);
  });

  it('adds members in bulk, skips existing ones and emits one event per real change', async () => {
    expect(await json(await api.call('PUT', `/groups/${k65.id}/members`, { user_ids: [u[0], u[1]] }), 200)).toEqual({ added: [u[0], u[1]].sort() });
    expect(await json(await api.call('PUT', `/groups/${k65.id}/members`, { user_ids: [u[1], u[2], u[2]] }), 200)).toEqual({ added: [u[2]] });
    expect(await json(await api.call('PUT', `/groups/${k65.id}/members`, { user_ids: [u[0]] }), 200)).toEqual({ added: [] });
    expect(await outboxEvents(api.pool, k65.id)).toEqual([
      { event_type: 'GroupMembershipChanged', payload: { added: [u[0], u[1]].sort(), removed: [] } },
      { event_type: 'GroupMembershipChanged', payload: { added: [u[2]], removed: [] } },
    ]);
    expect(await auditActions(api.pool, k65.id)).toEqual(['group.create', 'group.members_add', 'group.members_add']);
    const members = await json<{ external_id: string }[]>(await api.call('GET', `/groups/${k65.id}/members`), 200);
    expect(members.map((m) => m.external_id)).toEqual(['SV001', 'SV002', 'SV003']);
    const list = await json<Group[]>(await api.call('GET', '/groups'), 200);
    expect(list.map((g) => [g.name, g.member_count])).toEqual([['ATTT-K66', 0], ['CNTT-K65', 3]]);
  });

  it('adds nobody when any user id is unknown, and validates the body', async () => {
    const res = await api.call('PUT', `/groups/${k65.id}/members`, { user_ids: [u[3], missing] });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; details: { value: string }[] } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details.map((d) => d.value)).toEqual([missing]);
    expect((await json<unknown[]>(await api.call('GET', `/groups/${k65.id}/members`), 200))).toHaveLength(3);
    for (const bad of [{ user_ids: [] }, { user_ids: ['nope'] }, {}]) {
      expect((await api.call('PUT', `/groups/${k65.id}/members`, bad)).status).toBe(400);
    }
  });

  it('removes a member once; removing again is a no-op', async () => {
    expect((await api.call('DELETE', `/groups/${k65.id}/members/${u[0]}`)).status).toBe(204);
    expect((await api.call('DELETE', `/groups/${k65.id}/members/${u[0]}`)).status).toBe(204);
    const events = await outboxEvents(api.pool, k65.id);
    expect(events).toHaveLength(3);
    expect(events[2]).toEqual({ event_type: 'GroupMembershipChanged', payload: { added: [], removed: [u[0]] } });
  });

  it('refuses to delete a group used by a schedule (BR-017)', async () => {
    const zone = await api.pool.query("INSERT INTO zones (name, location) VALUES ('Lab 1', 'B1-201') RETURNING id");
    const schedule = await api.pool.query(
      `INSERT INTO schedules (name, subject_type, subject_group_id, target_type, target_zone_id, valid_from, days_of_week, start_minute, end_minute)
       VALUES ('Thực hành CSDL', 'group', $1, 'zone', $2, '2026-11-01', ARRAY['MONDAY'], 420, 600) RETURNING id`,
      [k65.id, zone.rows[0].id],
    );
    const res = await api.call('DELETE', `/groups/${k65.id}`);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: {
        code: 'REFERENCED_BY_SCHEDULE',
        message: 'The group is used by schedules',
        details: [{ schedule_id: schedule.rows[0].id, name: 'Thực hành CSDL' }],
      },
    });
    expect((await api.call('GET', `/groups/${k65.id}/members`)).status).toBe(200);
  });

  it('deletes an unused group with its memberships and audits it', async () => {
    await json(await api.call('PUT', `/groups/${attt.id}/members`, { user_ids: [u[3]] }), 200);
    expect((await api.call('DELETE', `/groups/${attt.id}`)).status).toBe(204);
    expect((await api.call('GET', `/groups/${attt.id}/members`)).status).toBe(404);
    expect((await api.pool.query('SELECT 1 FROM group_members WHERE group_id = $1', [attt.id])).rowCount).toBe(0);
    expect(await auditActions(api.pool, attt.id)).toEqual(['group.create', 'group.update', 'group.members_add', 'group.delete']);
  });

  it('returns 404 for an unknown group', async () => {
    for (const [method, path, body] of [
      ['PATCH', `/groups/${missing}`, { name: 'X' }],
      ['DELETE', `/groups/${missing}`, undefined],
      ['GET', `/groups/${missing}/members`, undefined],
      ['PUT', `/groups/${missing}/members`, { user_ids: [u[0]] }],
      ['DELETE', `/groups/${missing}/members/${u[0]}`, undefined],
    ] as const) {
      const res = await api.call(method, path, body);
      expect(res.status).toBe(404);
      expect(await errorCode(res)).toBe('NOT_FOUND');
    }
  });
});
