import Ajv2020 from 'ajv/dist/2020';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SnapshotService } from '../../src/distribution/snapshot.service';
import { cardMatchKey, deriveKm, verify } from '../../src/shared/crypto/crypto-v1';
import { loadMasterKey, loadUidVault } from '../../src/shared/crypto/uid-vault';
import { ApiContext, startSignedIn } from '../support/api';
import { kyselyOn, TEST_DATABASE_URL } from '../support/db';
import { testKeysDir } from '../support/keys';

const schema = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'contracts', 'schemas', 'snapshot-v1.schema.json'), 'utf8'));

interface Wire {
  workstation_id: string;
  version: number;
  key_version: number;
  users: { id: string; status: string; group_ids: string[] }[];
  cards: { match_key: string; card_id: string; user_id: string; status: string }[];
  schedules: { id: string; subject_type: string; subject_id: string; days_mask: number; target_os_username: string | null }[];
  profiles: { os_username: string; status: string; is_default: boolean }[];
}

(TEST_DATABASE_URL ? describe : describe.skip)('snapshot reconcile', () => {
  let api: ApiContext;
  let service: SnapshotService;
  let masterKey: Buffer;
  let u1: string;
  let u2: string;
  let u3: string;
  let group: string;
  let c1: string;
  let c2: string;
  let c3: string;
  let labA: string;
  let labB: string;
  let ws1: string;
  let ws2: string;
  let ws3: string;
  let s1: string;
  let s2: string;

  const json = async <T>(res: Response, status: number): Promise<T> => {
    expect(res.status).toBe(status);
    return (await res.json()) as T;
  };
  const create = async (path: string, body: unknown): Promise<string> => (await json<{ id: string }>(await api.call('POST', path, body), 201)).id;
  const ok = async (method: string, path: string, body?: unknown): Promise<void> => {
    await json(await api.call(method, path, body), 200);
  };
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
  const versions = async (id: string): Promise<number[]> =>
    (await api.pool.query('SELECT version::int AS version FROM snapshots WHERE workstation_id = $1 ORDER BY version', [id])).rows.map(
      (r: { version: number }) => r.version,
    );
  const desired = async (id: string): Promise<number | undefined> =>
    (await api.pool.query('SELECT desired_version::int AS v FROM sync_states WHERE workstation_id = $1', [id])).rows[0]?.v;
  const newest = async (id: string): Promise<{ wire: Wire; raw: Buffer; signature: string; keyVersion: number }> => {
    const row = (
      await api.pool.query(
        'SELECT payload_raw, hmac_signature, key_version FROM snapshots WHERE workstation_id = $1 ORDER BY version DESC LIMIT 1',
        [id],
      )
    ).rows[0];
    return { wire: JSON.parse(row.payload_raw.toString('utf8')), raw: row.payload_raw, signature: row.hmac_signature, keyVersion: row.key_version };
  };
  /** Runs reconcileAll and returns `[mqtt_identity, version]` pairs. */
  const run = async (): Promise<[string, number | null][]> => {
    const results = await service.reconcileAll();
    expect(results.filter((r) => r.error !== undefined)).toEqual([]);
    return results.map((r) => [r.mqtt_identity, r.version]);
  };

  beforeAll(async () => {
    api = await startSignedIn(TEST_DATABASE_URL as string);
    masterKey = loadMasterKey(testKeysDir());
    service = new SnapshotService(kyselyOn(api.pool), loadUidVault(testKeysDir(), 'k1'), masterKey);
    u1 = await create('/users', { external_id: 'SV001', full_name: 'Nguyễn Văn A' });
    u2 = await create('/users', { external_id: 'SV002', full_name: 'Trần Thị B' });
    u3 = await create('/users', { external_id: 'SV003', full_name: 'Lê Văn C' });
    group = await create('/groups', { name: 'CNTT-K65' });
    await ok('PUT', `/groups/${group}/members`, { user_ids: [u1] });
    c1 = await create('/cards', { uid: '1F0820CF', user_id: u1 });
    c2 = await create('/cards', { uid: '04A32B1C5D6E80', user_id: u2 });
    c3 = await create('/cards', { uid: 'AABBCCDD', user_id: u3 });
    labA = await create('/zones', { name: 'Lab A', location: 'B1-201' });
    labB = await create('/zones', { name: 'Lab B', location: 'B1-202' });
    ws1 = await workstation('lab-a-01', '02:00:00:00:00:01', labA, 'enrolled', ['student', 'exam']);
    ws2 = await workstation('lab-b-01', '02:00:00:00:00:02', labB, 'enrolled', []);
    ws3 = await workstation('lab-a-99', '02:00:00:00:00:03', labA, 'disabled', ['student']);
    const time = { valid_from: '2026-09-01', days_of_week: ['MONDAY', 'WEDNESDAY', 'FRIDAY'], start_time: '07:30', end_time: '11:30' };
    s1 = await create('/schedules', { name: 'Thực hành CSDL', subject: { type: 'group', id: group }, target: { type: 'zone', id: labA }, ...time });
    s2 = await create('/schedules', {
      name: 'Thi',
      subject: { type: 'user', id: u2 },
      target: { type: 'workstation', id: ws1 },
      ...time,
      target_os_username: 'exam',
    });
  });
  afterAll(async () => api.close());

  it('issues version 1 for every enrolled workstation with only the data that workstation needs (INV-012)', async () => {
    expect(await run()).toEqual([
      ['lab-a-01', 1],
      ['lab-b-01', 1],
    ]);
    expect([await desired(ws1), await desired(ws2), await desired(ws3)]).toEqual([1, 1, undefined]);
    expect(await versions(ws3)).toEqual([]);

    const { wire, raw, signature, keyVersion } = await newest(ws1);
    const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema);
    expect([validate(wire), validate.errors]).toEqual([true, null]);
    expect(wire).toMatchObject({ workstation_id: 'lab-a-01', version: 1, key_version: 1 });
    expect(keyVersion).toBe(1);
    const km = deriveKm(masterKey, 'lab-a-01', 1);
    expect(verify(km, 'snapshot-v1', raw, signature)).toBe(true);

    expect(wire.users.map((u) => u.id)).toEqual([u1, u2].sort());
    expect(wire.users.find((u) => u.id === u1)?.group_ids).toEqual([group]);
    expect(wire.users.find((u) => u.id === u2)?.group_ids).toEqual([]);
    expect(wire.cards.map((c) => c.card_id)).toEqual([c1, c2].sort());
    expect(wire.cards.find((c) => c.card_id === c1)).toEqual({ match_key: cardMatchKey(km, '1F0820CF'), card_id: c1, user_id: u1, status: 'active' });
    expect(wire.schedules.map((s) => s.id)).toEqual([s1, s2].sort());
    expect(wire.schedules.find((s) => s.id === s1)).toMatchObject({ subject_type: 'group', subject_id: group, days_mask: 21, target_os_username: null });
    expect(wire.schedules.find((s) => s.id === s2)).toMatchObject({ subject_type: 'user', subject_id: u2, target_os_username: 'exam' });
    expect(wire.profiles).toEqual([
      { os_username: 'exam', status: 'enabled', is_default: false },
      { os_username: 'student', status: 'enabled', is_default: true },
    ]);
    expect(raw.toString('utf8')).not.toContain('1F0820CF');

    const empty = (await newest(ws2)).wire;
    expect(empty).toMatchObject({ workstation_id: 'lab-b-01', version: 1, users: [], cards: [], schedules: [], profiles: [] });
  });

  it('issues nothing while the content is unchanged', async () => {
    expect(await run()).toEqual([
      ['lab-a-01', null],
      ['lab-b-01', null],
    ]);
    await ok('PATCH', `/groups/${group}`, { name: 'CNTT-K65A', description: 'đổi tên không đổi snapshot' });
    await ok('PATCH', `/zones/${labA}`, { location: 'B1-999' });
    expect(await run()).toEqual([
      ['lab-a-01', null],
      ['lab-b-01', null],
    ]);
    expect([await versions(ws1), await versions(ws2)]).toEqual([[1], [1]]);
  });

  it('issues a new version only for the workstations whose content changed', async () => {
    await ok('POST', `/cards/${c1}/disable`);
    expect(await run()).toEqual([
      ['lab-a-01', 2],
      ['lab-b-01', null],
    ]);
    expect((await newest(ws1)).wire.cards.find((c) => c.card_id === c1)?.status).toBe('disabled');

    await ok('PUT', `/groups/${group}/members`, { user_ids: [u3] });
    expect((await run())[0]).toEqual(['lab-a-01', 3]);
    let wire = (await newest(ws1)).wire;
    expect(wire.users.map((u) => u.id)).toEqual([u1, u2, u3].sort());
    expect(wire.cards.map((c) => c.card_id)).toEqual([c1, c2, c3].sort());

    await ok('POST', `/users/${u2}/deactivate`);
    expect((await run())[0]).toEqual(['lab-a-01', 4]);
    expect((await newest(ws1)).wire.users.find((u) => u.id === u2)?.status).toBe('inactive');

    await ok('PATCH', `/workstations/${ws1}/profiles/exam`, { status: 'disabled' });
    expect((await run())[0]).toEqual(['lab-a-01', 5]);
    expect((await newest(ws1)).wire.profiles[0]).toEqual({ os_username: 'exam', status: 'disabled', is_default: false });

    await ok('POST', `/schedules/${s2}/disable`);
    expect((await run())[0]).toEqual(['lab-a-01', 6]);
    wire = (await newest(ws1)).wire;
    expect(wire.schedules.map((s) => s.id)).toEqual([s1]);
    expect(wire.users.map((u) => u.id)).toEqual([u1, u3].sort());
    expect(wire.cards.map((c) => c.card_id)).toEqual([c1, c3].sort());
    expect([await desired(ws1), await desired(ws2)]).toEqual([6, 1]);
  });

  it('follows a workstation into its new zone', async () => {
    await ok('PATCH', `/workstations/${ws2}`, { zone_id: labA });
    expect(await run()).toEqual([
      ['lab-a-01', null],
      ['lab-b-01', 2],
    ]);
    const { wire, raw, signature } = await newest(ws2);
    expect(wire.schedules.map((s) => s.id)).toEqual([s1]);
    expect(wire.users.map((u) => u.id)).toEqual([u1, u3].sort());
    expect(wire.profiles).toEqual([]);
    const km = deriveKm(masterKey, 'lab-b-01', 1);
    expect(verify(km, 'snapshot-v1', raw, signature)).toBe(true);
    expect(wire.cards.find((c) => c.card_id === c1)?.match_key).toBe(cardMatchKey(km, '1F0820CF'));
    expect(verify(deriveKm(masterKey, 'lab-a-01', 1), 'snapshot-v1', raw, signature)).toBe(false);
  });

  it('keeps only the five newest snapshots of a workstation', async () => {
    await ok('POST', `/schedules/${s2}/enable`);
    expect(await run()).toEqual([
      ['lab-a-01', 7],
      ['lab-b-01', null],
    ]);
    expect(await versions(ws1)).toEqual([3, 4, 5, 6, 7]);
    expect(await versions(ws2)).toEqual([1, 2]);
  });

  it('jumps over a version the workstation already reports, even with unchanged content (EF-4b)', async () => {
    await api.pool.query('UPDATE sync_states SET acked_version = 20 WHERE workstation_id = $1', [ws2]);
    expect(await service.reconcile(ws2)).toBe(21);
    expect(await desired(ws2)).toBe(21);
    expect((await newest(ws2)).wire.version).toBe(21);
    expect(await service.reconcile(ws2)).toBeNull();
    expect(await versions(ws2)).toEqual([1, 2, 21]);
  });

  it('issues nothing for a disabled or unknown workstation', async () => {
    expect(await service.reconcile(ws3)).toBeNull();
    expect(await service.reconcile('00000000-0000-4000-8000-000000000000')).toBeNull();
    expect(await versions(ws3)).toEqual([]);
  });

  it('reports a workstation whose snapshot cannot be built and still handles the others', async () => {
    // c2 belongs to u2, who is only scheduled on lab-a-01; a wrong auth tag makes its UID undecryptable.
    await api.pool.query("UPDATE cards SET uid_auth_tag = decode(repeat('00', 16), 'hex') WHERE id = $1", [c2]);
    // A real change for lab-b-01, which does not carry c2, so that it has something to issue.
    await api.pool.query("INSERT INTO workstation_profiles (workstation_id, os_username, display_name, is_default) VALUES ($1, 'student', 'Sinh viên', true)", [ws2]);
    const results = await service.reconcileAll();
    expect(results.map((r) => [r.mqtt_identity, r.version, typeof r.error])).toEqual([
      ['lab-a-01', null, 'string'],
      ['lab-b-01', 22, 'undefined'],
    ]);
    expect(await versions(ws1)).toEqual([3, 4, 5, 6, 7]);
  });
});
