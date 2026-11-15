import { ApiContext, outboxEvents, startSignedIn } from '../support/api';
import { TEST_DATABASE_URL } from '../support/db';

interface Warning {
  code: string;
  message: string;
  workstations: { id: string; mqtt_identity: string }[];
  schedule?: { id: string; name: string };
  target_os_username?: string | null;
}
interface Validation {
  errors: { field: string }[];
  warnings: Warning[];
}

(TEST_DATABASE_URL ? describe : describe.skip)('schedule validation', () => {
  let api: ApiContext;
  let u1: string;
  let u2: string;
  let group: string;
  let labA: string;
  let labB: string;
  let ws1: string;
  let ws2: string;
  let ws3: string;
  let practice: string;
  const missing = '00000000-0000-4000-8000-000000000000';

  const json = async <T>(res: Response, status: number): Promise<T> => {
    expect(res.status).toBe(status);
    return (await res.json()) as T;
  };
  const create = async (path: string, body: unknown): Promise<string> => (await json<{ id: string }>(await api.call('POST', path, body), 201)).id;
  const workstation = async (identity: string, mac: string, zoneId: string | null, status: string, profiles: string[]): Promise<string> => {
    const res = await api.pool.query(
      `INSERT INTO workstations (mqtt_identity, machine_id, mac_address, hostname, public_key, zone_id, status)
       VALUES ($1, $2, $3, $4, 'pk', $5, $6) RETURNING id`,
      [identity, `machine-${identity}`, mac, `host-${identity}`, zoneId, status],
    );
    const id: string = res.rows[0].id;
    for (const [i, name] of profiles.entries()) {
      await api.pool.query('INSERT INTO workstation_profiles (workstation_id, os_username, display_name, is_default) VALUES ($1, $2, $2, $3)', [id, name, i === 0]);
    }
    return id;
  };
  // A schedule that clashes with nothing unless a test overrides subject, target, time or profile.
  const input = (change: Record<string, unknown> = {}) => ({
    name: 'Kiểm tra',
    subject: { type: 'user', id: u2 },
    target: { type: 'workstation', id: ws1 },
    valid_from: '2026-09-01',
    days_of_week: ['MONDAY'],
    start_time: '10:00',
    end_time: '12:00',
    ...change,
  });
  const validate = async (change: Record<string, unknown> = {}): Promise<Validation> =>
    json<Validation>(await api.call('POST', '/schedules/validate', input(change)), 200);
  const codes = (v: Validation): string[] => v.warnings.map((w) => w.code);
  const machines = (w: Warning): string[] => w.workstations.map((m) => m.mqtt_identity);

  beforeAll(async () => {
    api = await startSignedIn(TEST_DATABASE_URL as string);
    u1 = await create('/users', { external_id: 'SV001', full_name: 'Nguyễn Văn A' });
    u2 = await create('/users', { external_id: 'SV002', full_name: 'Trần Thị B' });
    group = await create('/groups', { name: 'CNTT-K65' });
    await json(await api.call('PUT', `/groups/${group}/members`, { user_ids: [u1] }), 200);
    labA = await create('/zones', { name: 'Lab A', location: 'B1-201' });
    labB = await create('/zones', { name: 'Lab B', location: 'B1-202' });
    // The first profile of each workstation is its default.
    ws1 = await workstation('lab-a-01', '02:00:00:00:00:01', labA, 'enrolled', ['student', 'exam']);
    ws2 = await workstation('lab-a-02', '02:00:00:00:00:02', labA, 'enrolled', ['student']);
    ws3 = await workstation('lab-x-01', '02:00:00:00:00:03', null, 'enrolled', []);
    await workstation('lab-a-99', '02:00:00:00:00:04', labA, 'disabled', []);
    // The group uses Lab A on Monday and Wednesday morning with the default profile (student).
    practice = await create('/schedules', {
      name: 'Thực hành CSDL',
      subject: { type: 'group', id: group },
      target: { type: 'zone', id: labA },
      valid_from: '2026-09-01',
      days_of_week: ['MONDAY', 'WEDNESDAY'],
      start_time: '07:30',
      end_time: '11:30',
    });
  });
  afterAll(async () => api.close());

  it('answers without errors or warnings for a schedule that conflicts with nothing, and writes nothing', async () => {
    expect(await validate({ target_os_username: 'exam' })).toEqual({ errors: [], warnings: [] });
    expect((await json<unknown[]>(await api.call('GET', '/schedules'), 200))).toHaveLength(1);
    expect((await api.pool.query("SELECT 1 FROM server_outbox WHERE event_type <> 'ScheduleCreated' AND aggregate_type = 'schedule'")).rowCount).toBe(0);
    expect(await outboxEvents(api.pool, practice)).toHaveLength(1);
  });

  it('reports the errors saving would raise as data, and still rejects a malformed body', async () => {
    const result = await validate({ start_time: '12:00', subject: { type: 'user', id: missing } });
    expect(result.errors.map((e) => e.field)).toEqual(['end_time', 'subject.id']);
    expect(result.warnings).toEqual([]);
    expect((await api.call('POST', '/schedules/validate', input({ days_of_week: [] }))).status).toBe(400);
    expect((await api.call('POST', '/schedules/validate', input({ schedule_id: 'nope' }))).status).toBe(400);
  });

  it('warns about ambiguous_profile when a member of the group gets another profile at an overlapping time (BR-016)', async () => {
    const clash = await validate({ subject: { type: 'user', id: u1 }, target_os_username: 'exam' });
    expect(clash.errors).toEqual([]);
    expect(clash.warnings).toHaveLength(1);
    expect(clash.warnings[0]).toMatchObject({
      code: 'ambiguous_profile',
      schedule: { id: practice, name: 'Thực hành CSDL' },
      workstations: [{ id: ws1, mqtt_identity: 'lab-a-01' }],
    });
    const quiet: Record<string, unknown>[] = [
      { days_of_week: ['TUESDAY'] },
      { start_time: '11:30', end_time: '13:00' },
      { valid_from: '2026-01-01', valid_to: '2026-08-31' },
      { target_os_username: 'student' },
      { target_os_username: undefined },
      { subject: { type: 'user', id: u2 } },
    ];
    for (const change of quiet) {
      const result = await validate({ subject: { type: 'user', id: u1 }, target_os_username: 'exam', ...change });
      expect([JSON.stringify(change), codes(result)]).toEqual([JSON.stringify(change), []]);
    }
  });

  it('warns about missing_profile on enrolled workstations without the wanted or a default profile (D-009)', async () => {
    const named = await validate({ target: { type: 'zone', id: labA }, days_of_week: ['SUNDAY'], target_os_username: 'exam' });
    expect(codes(named)).toEqual(['missing_profile']);
    expect(named.warnings[0]).toMatchObject({ target_os_username: 'exam', workstations: [{ id: ws2, mqtt_identity: 'lab-a-02' }] });
    const byDefault = await validate({ target: { type: 'workstation', id: ws3 } });
    expect(codes(byDefault)).toEqual(['missing_profile']);
    expect(byDefault.warnings[0]).toMatchObject({ target_os_username: null, workstations: [{ id: ws3, mqtt_identity: 'lab-x-01' }] });
  });

  it('lists both warnings, and leaves the edited schedule out of the comparison', async () => {
    const change = {
      subject: { type: 'group', id: group },
      target: { type: 'zone', id: labA },
      start_time: '08:00',
      end_time: '09:00',
      target_os_username: 'exam',
    };
    const asNew = await validate(change);
    expect(codes(asNew)).toEqual(['ambiguous_profile', 'missing_profile']);
    expect(machines(asNew.warnings[0])).toEqual(['lab-a-01', 'lab-a-02']);
    expect(machines(asNew.warnings[1])).toEqual(['lab-a-02']);
    const asEdit = await validate({ ...change, schedule_id: practice });
    expect(codes(asEdit)).toEqual(['missing_profile']);
  });

  it('warns for a zone without workstations only when two explicit profiles differ', async () => {
    const lecture = await create('/schedules', input({ name: 'Lý thuyết', subject: { type: 'user', id: u1 }, target: { type: 'zone', id: labB }, target_os_username: 'student' }));
    const sameZone = { subject: { type: 'user', id: u1 }, target: { type: 'zone', id: labB } };
    const clash = await validate({ ...sameZone, target_os_username: 'exam' });
    expect(codes(clash)).toEqual(['ambiguous_profile']);
    expect(clash.warnings[0]).toMatchObject({ schedule: { id: lecture, name: 'Lý thuyết' }, workstations: [] });
    expect(codes(await validate({ ...sameZone, target_os_username: 'student' }))).toEqual([]);
    expect(codes(await validate(sameZone))).toEqual([]);
  });

  it('ignores disabled schedules', async () => {
    await json(await api.call('POST', `/schedules/${practice}/disable`), 200);
    expect(codes(await validate({ subject: { type: 'user', id: u1 }, target_os_username: 'exam' }))).toEqual([]);
  });
});
