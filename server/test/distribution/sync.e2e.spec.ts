import { OutgoingMessage, SyncService } from '../../src/distribution/sync.service';
import { validateMessage } from '../../src/shared/contracts';
import { deriveKm, verify } from '../../src/shared/crypto/crypto-v1';
import { loadMasterKey } from '../../src/shared/crypto/uid-vault';
import { ApiContext, outboxEvents, startSignedIn } from '../support/api';
import { TEST_DATABASE_URL } from '../support/db';
import { testKeysDir } from '../support/keys';

const BOOT_1 = '9f2c8d14-5b1e-4c33-9a70-0d6f2e8b1c47';
const BOOT_2 = '11111111-2222-4333-8444-555555555555';
const NONCE = '7f3a9c1e5b2d4f60a8e1c3b5d7f90214';

(TEST_DATABASE_URL ? describe : describe.skip)('sync: Hello and heartbeat', () => {
  let api: ApiContext;
  let sync: SyncService;
  let km: Buffer;
  let ws: string;
  let clock = Date.now();

  const q = async (text: string, values: unknown[] = []) => (await api.pool.query(text, values)).rows;
  const hello = (change: Record<string, unknown> = {}): Buffer =>
    Buffer.from(
      JSON.stringify({
        schema: 'hello-v1',
        workstation_id: 'lab-a-01',
        boot_id: BOOT_1,
        agent_version: '1.0.0',
        snapshot_version: 0,
        key_version: 1,
        lease_nonce: NONCE,
        pending_outbox_count: 0,
        profiles: ['student', 'labuser'],
        local_time: clock / 1000,
        ...change,
      }),
    );
  const heartbeat = (change: Record<string, unknown> = {}): Buffer =>
    Buffer.from(
      JSON.stringify({
        schema: 'heartbeat-v1',
        workstation_id: 'lab-a-01',
        boot_id: BOOT_1,
        snapshot_version: 1,
        lease_nonce: NONCE,
        trust_state: 'Fresh',
        local_time: clock / 1000,
        clock_skew_detected: false,
        last_apply_error: null,
        active_session_id: null,
        profiles: ['student', 'labuser'],
        ...change,
      }),
    );
  const status = async () =>
    (
      await q(
        `SELECT connectivity, boot_id, trust_state, clock_skew_detected, last_apply_error, reconcile_state, draining_started_at IS NOT NULL AS draining
         FROM workstation_statuses WHERE workstation_id = $1`,
        [ws],
      )
    )[0];
  const versions = async (): Promise<{ desired: number; acked: number }> =>
    (await q('SELECT desired_version::int AS desired, acked_version::int AS acked FROM sync_states WHERE workstation_id = $1', [ws]))[0];
  const parsed = (m: OutgoingMessage) => JSON.parse(m.payload.toString('utf8'));

  beforeAll(async () => {
    api = await startSignedIn(TEST_DATABASE_URL as string);
    sync = api.ctx.app.get(SyncService, { strict: false });
    sync.nowMs = () => clock;
    km = deriveKm(loadMasterKey(testKeysDir()), 'lab-a-01', 1);
    ws = (
      await q(
        `INSERT INTO workstations (mqtt_identity, machine_id, mac_address, hostname, public_key)
         VALUES ('lab-a-01', 'machine-01', '02:00:00:00:00:01', 'host-01', 'pk') RETURNING id`,
      )
    )[0].id;
    await q(
      `INSERT INTO workstations (mqtt_identity, machine_id, mac_address, hostname, public_key, status)
       VALUES ('lab-a-99', 'machine-99', '02:00:00:00:00:99', 'host-99', 'pk', 'disabled')`,
    );
    await q(
      `INSERT INTO enrollment_requests (fetch_code_hash, machine_id, mac_address, hostname, csr_pem, public_key, status, reviewed_at, workstation_id)
       VALUES (repeat('a', 64), 'machine-01', '02:00:00:00:00:01', 'host-01', 'csr', 'pk', 'approved', now(), $1)`,
      [ws],
    );
  });
  afterAll(async () => api.close());

  it('ignores what it cannot trust: bad JSON, schema violations, another identity, unknown or disabled workstations', async () => {
    const attempts: [string, Buffer][] = [
      ['lab-a-01', Buffer.from('not json')],
      ['lab-a-01', hello({ lease_nonce: 'short' })],
      ['lab-a-01', hello({ boot_id: undefined })],
      ['lab-a-01', hello({ workstation_id: 'lab-a-02' })],
      ['lab-a-02', hello({ workstation_id: 'lab-a-02' })],
      ['lab-a-99', hello({ workstation_id: 'lab-a-99' })],
    ];
    for (const [identity, raw] of attempts) expect(await sync.handleHello(identity, raw)).toEqual([]);
    expect(await sync.handleHeartbeat('lab-a-01', hello())).toEqual([]);
    expect(await q('SELECT 1 FROM workstation_statuses')).toEqual([]);
    expect(await q('SELECT 1 FROM snapshots')).toEqual([]);
  });

  it('answers the first Hello with snapshot version 1, records the workstation as online and discovers its profiles', async () => {
    const [message, ...rest] = await sync.handleHello('lab-a-01', hello());
    expect(rest).toEqual([]);
    expect(message.topic).toBe('lab/workstation/lab-a-01/snapshot');
    expect(message.retain).toBe(true);
    expect(verify(km, 'snapshot-v1', message.payload, message.signature)).toBe(true);
    expect(validateMessage('snapshot-v1', parsed(message))).toBeNull();
    expect(parsed(message)).toMatchObject({
      workstation_id: 'lab-a-01',
      version: 1,
      profiles: [
        { os_username: 'labuser', status: 'enabled', is_default: false },
        { os_username: 'student', status: 'enabled', is_default: true },
      ],
    });
    expect(await status()).toEqual({
      connectivity: 'online',
      boot_id: BOOT_1,
      trust_state: null,
      clock_skew_detected: false,
      last_apply_error: null,
      reconcile_state: 'Idle',
      draining: false,
    });
    expect(await versions()).toEqual({ desired: 1, acked: 0 });
    expect(await outboxEvents(api.pool, ws)).toEqual([{ event_type: 'WorkstationProfilesDiscovered', payload: { added: ['student', 'labuser'] } }]);
    // D-014.4: the credentials cannot be fetched after the first Hello.
    expect((await q('SELECT fetch_code_invalidated_at IS NOT NULL AS done FROM enrollment_requests WHERE workstation_id = $1', [ws]))[0].done).toBe(true);
  });

  it('answers a heartbeat on the desired version with a signed lease that echoes the nonce', async () => {
    const nonce = 'c41b0e7a92d35f8816a4e0b2c9d7f351';
    const [message, ...rest] = await sync.handleHeartbeat('lab-a-01', heartbeat({ lease_nonce: nonce }));
    expect(rest).toEqual([]);
    expect(message.topic).toBe('lab/workstation/lab-a-01/lease');
    expect(message.retain).toBe(false);
    expect(verify(km, 'lease-v1', message.payload, message.signature)).toBe(true);
    expect(validateMessage('lease-v1', parsed(message))).toBeNull();
    expect(parsed(message)).toEqual({
      schema: 'lease-v1',
      workstation_id: 'lab-a-01',
      desired_version: 1,
      server_time: clock / 1000,
      lease_duration_sec: 86400,
      nonce,
    });
    expect(await status()).toMatchObject({ connectivity: 'online', trust_state: 'Fresh', last_apply_error: null, reconcile_state: 'Idle' });
    expect(await versions()).toEqual({ desired: 1, acked: 1 });
    // Known profiles are not rediscovered.
    expect(await outboxEvents(api.pool, ws)).toHaveLength(1);
    // A Hello on the desired version gets a lease too.
    const [again] = await sync.handleHello('lab-a-01', hello({ snapshot_version: 1 }));
    expect(again.topic).toBe('lab/workstation/lab-a-01/lease');
  });

  it('stores what a heartbeat reports and adds a newly found profile without touching the default', async () => {
    await sync.handleHeartbeat('lab-a-01', heartbeat({ trust_state: 'Expired', clock_skew_detected: true, last_apply_error: 'older_version', profiles: ['student', 'exam'] }));
    expect(await status()).toMatchObject({ trust_state: 'Expired', clock_skew_detected: true, last_apply_error: 'older_version' });
    const profiles = await q('SELECT os_username, is_default, status FROM workstation_profiles WHERE workstation_id = $1 ORDER BY os_username', [ws]);
    expect(profiles).toEqual([
      { os_username: 'exam', is_default: false, status: 'enabled' },
      { os_username: 'labuser', is_default: false, status: 'enabled' },
      { os_username: 'student', is_default: true, status: 'enabled' },
    ]);
    const events = await outboxEvents(api.pool, ws);
    expect(events[1]).toEqual({ event_type: 'WorkstationProfilesDiscovered', payload: { added: ['exam'] } });
    // A Hello does not carry these fields and keeps the last reported ones, but measures the clock itself.
    await sync.handleHello('lab-a-01', hello({ snapshot_version: 1, local_time: clock / 1000 + 120 }));
    expect(await status()).toMatchObject({ trust_state: 'Expired', last_apply_error: 'older_version', clock_skew_detected: true });
    await sync.handleHello('lab-a-01', hello({ snapshot_version: 1 }));
    expect((await status()).clock_skew_detected).toBe(false);
  });

  it('sends the snapshot to a workstation that is behind, at most once a minute on heartbeats', async () => {
    clock += 61_000; // past the resend window opened by the first Hello
    const [first] = await sync.handleHeartbeat('lab-a-01', heartbeat({ snapshot_version: 0 }));
    // The exam profile found above changed the content, so reconcile issues version 2.
    expect([first.topic, parsed(first).version]).toEqual(['lab/workstation/lab-a-01/snapshot', 2]);
    expect(await versions()).toEqual({ desired: 2, acked: 0 });
    expect(await sync.handleHeartbeat('lab-a-01', heartbeat({ snapshot_version: 0 }))).toEqual([]);
    clock += 61_000;
    const [later] = await sync.handleHeartbeat('lab-a-01', heartbeat({ snapshot_version: 0 }));
    expect(parsed(later).version).toBe(2);
    // A Hello is always answered.
    const [onHello] = await sync.handleHello('lab-a-01', hello({ snapshot_version: 1 }));
    expect(parsed(onHello).version).toBe(2);
    const [lease] = await sync.handleHeartbeat('lab-a-01', heartbeat({ snapshot_version: 2 }));
    expect(lease.topic).toBe('lab/workstation/lab-a-01/lease');
  });

  it('issues a version above the one a workstation is ahead with (D-016)', async () => {
    const [message] = await sync.handleHello('lab-a-01', hello({ snapshot_version: 50 }));
    expect(parsed(message).version).toBe(51);
    expect(await versions()).toEqual({ desired: 51, acked: 50 });
    const [lease] = await sync.handleHeartbeat('lab-a-01', heartbeat({ snapshot_version: 51 }));
    expect(parsed(lease)).toMatchObject({ schema: 'lease-v1', desired_version: 51 });
  });

  it('puts the workstation in Draining when its boot id changes (XINV-008)', async () => {
    expect(await status()).toMatchObject({ reconcile_state: 'Idle', draining: false });
    await sync.handleHeartbeat('lab-a-01', heartbeat({ snapshot_version: 51, boot_id: BOOT_2 }));
    expect(await status()).toMatchObject({ boot_id: BOOT_2, reconcile_state: 'Draining', draining: true });
    await sync.handleHeartbeat('lab-a-01', heartbeat({ snapshot_version: 51, boot_id: BOOT_2 }));
    expect(await status()).toMatchObject({ boot_id: BOOT_2, reconcile_state: 'Draining', draining: true });
  });

  it('marks a workstation offline after 90 seconds without a heartbeat, and online again on the next one (BR-019)', async () => {
    expect(await sync.markOffline()).toEqual([]);
    await q("UPDATE workstation_statuses SET last_heartbeat_at = now() - interval '2 minutes' WHERE workstation_id = $1", [ws]);
    expect(await sync.markOffline()).toEqual(['lab-a-01']);
    expect((await status()).connectivity).toBe('offline');
    expect(await sync.markOffline()).toEqual([]);
    await sync.handleHeartbeat('lab-a-01', heartbeat({ snapshot_version: 51, boot_id: BOOT_2 }));
    expect((await status()).connectivity).toBe('online');
  });

  it('does not invalidate the fetch code on a Hello with an old key version, but invalidates on the new key version', async () => {
    await q('UPDATE enrollment_requests SET fetch_code_invalidated_at = NULL WHERE workstation_id = $1', [ws]);
    await q('UPDATE workstations SET key_version = 2 WHERE id = $1', [ws]);

    await sync.handleHello('lab-a-01', hello({ key_version: 1 }));
    expect((await q('SELECT fetch_code_invalidated_at IS NOT NULL AS done FROM enrollment_requests WHERE workstation_id = $1', [ws]))[0].done).toBe(false);

    await sync.handleHello('lab-a-01', hello({ key_version: 2 }));
    expect((await q('SELECT fetch_code_invalidated_at IS NOT NULL AS done FROM enrollment_requests WHERE workstation_id = $1', [ws]))[0].done).toBe(true);
  });
});
