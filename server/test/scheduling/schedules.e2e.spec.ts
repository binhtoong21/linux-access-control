import { ApiContext, auditActions, errorCode, outboxEvents, startSignedIn } from '../support/api';
import { TEST_DATABASE_URL } from '../support/db';

interface Schedule {
  id: string;
  name: string;
  subject: { type: string; id: string; name: string; external_id?: string };
  target: { type: string; id: string; name: string };
  valid_from: string;
  valid_to: string | null;
  days_of_week: string[];
  start_time: string;
  end_time: string;
  target_os_username: string | null;
  status: string;
}

(TEST_DATABASE_URL ? describe : describe.skip)('schedules', () => {
  let api: ApiContext;
  let u1: string;
  let u2: string;
  let group: string;
  let zone: string;
  let ws1: string;
  let ws2: string;
  let practice: Schedule;
  let exam: Schedule;
  const missing = '00000000-0000-4000-8000-000000000000';

  const json = async <T>(res: Response, status: number): Promise<T> => {
    expect(res.status).toBe(status);
    return (await res.json()) as T;
  };
  const create = async (path: string, body: unknown): Promise<string> => (await json<{ id: string }>(await api.call('POST', path, body), 201)).id;
  const workstation = async (identity: string, mac: string, zoneId: string | null): Promise<string> => {
    const res = await api.pool.query(
      `INSERT INTO workstations (mqtt_identity, machine_id, mac_address, hostname, public_key, zone_id)
       VALUES ($1, $1, $2, $1, 'pk', $3) RETURNING id`,
      [identity, mac, zoneId],
    );
    return res.rows[0].id;
  };
  const names = async (query: string): Promise<string[]> => (await json<Schedule[]>(await api.call('GET', `/schedules${query}`), 200)).map((s) => s.name);
  const base = () => ({
    name: 'Thực hành CSDL',
    subject: { type: 'group', id: group },
    target: { type: 'zone', id: zone },
    valid_from: '2026-09-01',
    days_of_week: ['MONDAY'],
    start_time: '07:30',
    end_time: '11:30',
  });

  beforeAll(async () => {
    api = await startSignedIn(TEST_DATABASE_URL as string);
    u1 = await create('/users', { external_id: 'SV001', full_name: 'Nguyễn Văn A' });
    u2 = await create('/users', { external_id: 'SV002', full_name: 'Trần Thị B' });
    group = await create('/groups', { name: 'CNTT-K65' });
    await json(await api.call('PUT', `/groups/${group}/members`, { user_ids: [u1] }), 200);
    zone = await create('/zones', { name: 'Lab A', location: 'B1-201' });
    ws1 = await workstation('lab-a-01', '02:00:00:00:00:01', zone);
    ws2 = await workstation('lab-x-01', '02:00:00:00:00:02', null);
  });
  afterAll(async () => api.close());

  it('creates schedules for a group on a zone and for a user on a workstation', async () => {
    practice = await json<Schedule>(
      await api.call('POST', '/schedules', { ...base(), name: '  Thực hành CSDL ', days_of_week: ['FRIDAY', 'MONDAY', 'MONDAY'] }),
      201,
    );
    expect(practice).toMatchObject({
      name: 'Thực hành CSDL',
      subject: { type: 'group', id: group, name: 'CNTT-K65' },
      target: { type: 'zone', id: zone, name: 'Lab A' },
      valid_from: '2026-09-01',
      valid_to: null,
      days_of_week: ['MONDAY', 'FRIDAY'],
      start_time: '07:30',
      end_time: '11:30',
      target_os_username: null,
      status: 'enabled',
    });
    exam = await json<Schedule>(
      await api.call('POST', '/schedules', {
        name: 'Thi cuối kỳ',
        subject: { type: 'user', id: u2 },
        target: { type: 'workstation', id: ws2 },
        valid_from: '2026-12-01',
        valid_to: '2027-01-15',
        days_of_week: ['SUNDAY'],
        start_time: '18:00',
        end_time: '24:00',
        target_os_username: 'exam',
      }),
      201,
    );
    expect(exam).toMatchObject({
      subject: { type: 'user', id: u2, name: 'Trần Thị B', external_id: 'SV002' },
      target: { type: 'workstation', id: ws2, name: 'lab-x-01' },
      valid_to: '2027-01-15',
      end_time: '24:00',
      target_os_username: 'exam',
    });
    expect(await auditActions(api.pool, practice.id)).toEqual(['schedule.create']);
    expect(await outboxEvents(api.pool, practice.id)).toEqual([
      { event_type: 'ScheduleCreated', payload: { after: { target_type: 'zone', target_workstation_id: null, target_zone_id: zone } } },
    ]);
    expect(await json<Schedule>(await api.call('GET', `/schedules/${exam.id}`), 200)).toMatchObject({ name: 'Thi cuối kỳ' });
  });

  it('rejects invalid input (VR-003, VR-004, VR-005, VR-009)', async () => {
    const bad: Record<string, unknown>[] = [
      { start_time: '11:30', end_time: '07:30' },
      { start_time: '07:30', end_time: '07:30' },
      { start_time: '7:30' },
      { end_time: '24:30' },
      { valid_to: '2026-08-31' },
      { valid_from: '2026-02-30' },
      { valid_from: '2026-09-01T00:00:00Z' },
      { days_of_week: [] },
      { days_of_week: ['FUNDAY'] },
      { target_os_username: 'Root' },
      { subject: { type: 'zone', id: group } },
      { subject: { type: 'user', id: missing } },
      { target: { type: 'workstation', id: missing } },
      { target: 'everywhere' },
      { name: '   ' },
      { subject: undefined },
    ];
    for (const change of bad) {
      const res = await api.call('POST', '/schedules', { ...base(), ...change });
      expect([JSON.stringify(change), res.status]).toEqual([JSON.stringify(change), 400]);
      expect(await errorCode(res)).toBe('VALIDATION_ERROR');
    }
    const res = await api.call('POST', '/schedules', { ...base(), subject: { type: 'user', id: missing }, target: { type: 'zone', id: missing } });
    const body = (await res.json()) as { error: { details: { field: string }[] } };
    expect(body.error.details.map((d) => d.field)).toEqual(['subject.id', 'target.id']);
    expect(await names('')).toEqual(['Thi cuối kỳ', 'Thực hành CSDL']);
  });

  it('filters the list by workstation, zone, group, user and status (FR-022)', async () => {
    expect(await names(`?zone_id=${zone}`)).toEqual(['Thực hành CSDL']);
    expect(await names(`?workstation_id=${ws1}`)).toEqual(['Thực hành CSDL']);
    expect(await names(`?workstation_id=${ws2}`)).toEqual(['Thi cuối kỳ']);
    expect(await names(`?group_id=${group}`)).toEqual(['Thực hành CSDL']);
    expect(await names(`?user_id=${u1}`)).toEqual(['Thực hành CSDL']);
    expect(await names(`?user_id=${u2}`)).toEqual(['Thi cuối kỳ']);
    expect(await names('?status=disabled')).toEqual([]);
    expect((await api.call('GET', '/schedules?zone_id=nope')).status).toBe(400);
  });

  it('updates only what changed and emits ScheduleUpdated with the old and new values', async () => {
    const change = { end_time: '12:00', target: { type: 'workstation', id: ws1 } };
    const updated = await json<Schedule>(await api.call('PATCH', `/schedules/${practice.id}`, change), 200);
    expect(updated).toMatchObject({ end_time: '12:00', start_time: '07:30', target: { type: 'workstation', id: ws1, name: 'lab-a-01' } });
    await json<Schedule>(await api.call('PATCH', `/schedules/${practice.id}`, change), 200);
    const events = await outboxEvents(api.pool, practice.id);
    expect(events).toHaveLength(2);
    expect(events[1]).toEqual({
      event_type: 'ScheduleUpdated',
      payload: {
        before: { target_type: 'zone', target_workstation_id: null, target_zone_id: zone, end_minute: 690 },
        after: { target_type: 'workstation', target_workstation_id: ws1, target_zone_id: null, end_minute: 720 },
      },
    });
    const late = await api.call('PATCH', `/schedules/${practice.id}`, { start_time: '13:00' });
    expect(late.status).toBe(400);
    expect(await errorCode(late)).toBe('VALIDATION_ERROR');
    const cleared = await json<Schedule>(await api.call('PATCH', `/schedules/${exam.id}`, { valid_to: null, target_os_username: null }), 200);
    expect(cleared).toMatchObject({ valid_to: null, target_os_username: null, valid_from: '2026-12-01' });
  });

  it('disables and enables a schedule; repeating the call is a no-op (FR-021)', async () => {
    expect((await json<Schedule>(await api.call('POST', `/schedules/${practice.id}/disable`), 200)).status).toBe('disabled');
    expect((await json<Schedule>(await api.call('POST', `/schedules/${practice.id}/disable`), 200)).status).toBe('disabled');
    expect(await names('?status=disabled')).toEqual(['Thực hành CSDL']);
    expect((await json<Schedule>(await api.call('POST', `/schedules/${practice.id}/enable`), 200)).status).toBe('enabled');
    const events = await outboxEvents(api.pool, practice.id);
    expect(events.map((e) => e.event_type)).toEqual(['ScheduleCreated', 'ScheduleUpdated', 'ScheduleDisabled', 'ScheduleEnabled']);
  });

  it('deletes a schedule, emits ScheduleDeleted and releases the deletion guard of its subject', async () => {
    expect((await api.call('DELETE', `/groups/${group}`)).status).toBe(409);
    expect((await api.call('DELETE', `/schedules/${practice.id}`)).status).toBe(204);
    expect((await api.call('GET', `/schedules/${practice.id}`)).status).toBe(404);
    const events = await outboxEvents(api.pool, practice.id);
    expect(events[4]).toEqual({
      event_type: 'ScheduleDeleted',
      payload: { before: { target_type: 'workstation', target_workstation_id: ws1, target_zone_id: null } },
    });
    expect(await auditActions(api.pool, practice.id)).toEqual([
      'schedule.create',
      'schedule.update',
      'schedule.disable',
      'schedule.enable',
      'schedule.delete',
    ]);
    expect((await api.call('DELETE', `/groups/${group}`)).status).toBe(204);
  });

  it('returns 404 for an unknown schedule', async () => {
    for (const [method, path, body] of [
      ['GET', `/schedules/${missing}`, undefined],
      ['PATCH', `/schedules/${missing}`, { name: 'X' }],
      ['DELETE', `/schedules/${missing}`, undefined],
      ['POST', `/schedules/${missing}/enable`, undefined],
      ['POST', `/schedules/${missing}/disable`, undefined],
    ] as const) {
      const res = await api.call(method, path, body);
      expect(res.status).toBe(404);
      expect(await errorCode(res)).toBe('NOT_FOUND');
    }
  });
});
