import { randomUUID } from 'node:crypto';
import { IngestService } from '../../src/operations/ingest.service';
import { validateMessage } from '../../src/shared/contracts';
import { deriveKm, verify } from '../../src/shared/crypto/crypto-v1';
import { loadMasterKey, loadUidVault } from '../../src/shared/crypto/uid-vault';
import { ApiContext, startSignedIn } from '../support/api';
import { TEST_DATABASE_URL } from '../support/db';
import { testKeysDir } from '../support/keys';

const BOOT = '9f2c8d14-5b1e-4c33-9a70-0d6f2e8b1c47';
const T0 = 1793048000;

(TEST_DATABASE_URL ? describe : describe.skip)('outbox ingest', () => {
  let api: ApiContext;
  let ingest: IngestService;
  let ws: string;
  let zone: string;
  let user: string;
  let card: string;
  let seq = 0;

  const q = async (text: string, values: unknown[] = []) => (await api.pool.query(text, values)).rows;
  const count = async (table: string): Promise<number> => (await q(`SELECT count(*)::int AS n FROM ${table}`))[0].n;
  /** Wraps records into a batch; outbox_seq is assigned in order. */
  const batch = (records: Record<string, unknown>[], change: Record<string, unknown> = {}): Buffer => {
    const numbered = records.map((r) => ({ outbox_seq: (seq += 1), ...r }));
    return Buffer.from(
      JSON.stringify({ schema: 'outbox-v1', workstation_id: 'lab-a-01', batch_id: `b-${seq}`, from_seq: numbered[0]?.outbox_seq ?? 1, to_seq: seq, records: numbered, ...change }),
    );
  };
  const swipe = (payload: Record<string, unknown> = {}, at = T0) => ({
    entry_id: randomUUID(),
    occurred_at: at,
    event_type: 'swipe_decision',
    payload: {
      outcome: 'granted',
      reason: 'granted',
      detail: null,
      card_uid: '1F0820CF',
      reader_raw: null,
      user: { id: user, external_id: 'SV001', full_name: 'Nguyễn Văn A' },
      card: { id: card, status: 'active' },
      target_os_username: 'student',
      matched_schedule_ids: ['3a9d5e10-2b4c-4d6e-8f10-1a2b3c4d5e6f'],
      data_version: 12,
      ...payload,
    },
  });
  const started = (sessionId: string, decisionId: string, at: number) => ({
    entry_id: randomUUID(),
    occurred_at: at,
    event_type: 'session_started',
    payload: { session_id: sessionId, decision_entry_id: decisionId, user_id: user, card_id: card, os_username: 'student', boot_id: BOOT, decided_at: at - 5, started_at: at, expires_at: at + 3600 },
  });
  const ended = (sessionId: string, at: number, payload: Record<string, unknown> = {}) => ({
    entry_id: randomUUID(),
    occurred_at: at,
    event_type: 'session_ended',
    payload: { session_id: sessionId, status: 'completed', end_reason: 'user_logout', end_source: 'reported', ended_at: at, ...payload },
  });
  const session = async (id: string) =>
    (await q('SELECT status, end_reason, end_source, extract(epoch from started_at)::float8 AS started, extract(epoch from ended_at)::float8 AS ended FROM sessions WHERE id = $1', [id]))[0];

  beforeAll(async () => {
    api = await startSignedIn(TEST_DATABASE_URL as string);
    ingest = api.ctx.app.get(IngestService, { strict: false });
    const post = async (path: string, body: unknown): Promise<string> => ((await (await api.call('POST', path, body)).json()) as { id: string }).id;
    zone = await post('/zones', { name: 'Lab A', location: 'B1-201' });
    user = await post('/users', { external_id: 'SV001', full_name: 'Nguyễn Văn A' });
    card = await post('/cards', { uid: '1F0820CF', user_id: user });
    ws = (
      await q(
        `INSERT INTO workstations (mqtt_identity, machine_id, mac_address, hostname, public_key, zone_id)
         VALUES ('lab-a-01', 'machine-01', '02:00:00:00:00:01', 'host-01', 'pk', $1) RETURNING id`,
        [zone],
      )
    )[0].id;
  });
  afterAll(async () => api.close());

  it('ignores a batch it cannot trust and sends no ACK', async () => {
    const good = batch([swipe()]);
    const attempts: [string, Buffer][] = [
      ['lab-a-01', Buffer.from('not json')],
      ['lab-a-01', Buffer.from('[1, 2]')],
      ['lab-a-01', batch([swipe()], { to_seq: undefined })],
      ['lab-a-01', batch([swipe()], { records: 'none' })],
      ['lab-a-01', batch([swipe()], { workstation_id: 'lab-a-02' })],
      ['lab-a-02', good],
      ['lab-zz-99', batch([swipe()], { workstation_id: 'lab-zz-99' })],
    ];
    for (const [identity, raw] of attempts) expect(await ingest.handleOutbox(identity, raw)).toEqual({ ack: null, applied: 0, duplicates: 0, rejected: 0 });
    expect([await count('audit_logs'), await count('ingest_rejects')]).toEqual([0, 0]);
  });

  it('stores a swipe as an audit record with the UID encrypted and acknowledges the batch with a signed ACK', async () => {
    const record = swipe();
    const raw = batch([record]);
    const result = await ingest.handleOutbox('lab-a-01', raw);
    expect(result).toMatchObject({ applied: 1, duplicates: 0, rejected: 0 });
    const ack = result.ack;
    expect(ack?.topic).toBe('lab/workstation/lab-a-01/command/ack');
    expect(ack?.retain).toBe(false);
    const ackBody = JSON.parse((ack?.payload as Buffer).toString('utf8'));
    expect(ackBody).toEqual({ schema: 'ack-v1', command: 'ack_outbox', workstation_id: 'lab-a-01', acked_seq: seq });
    expect(validateMessage('ack-v1', ackBody)).toBeNull();
    const km = deriveKm(loadMasterKey(testKeysDir()), 'lab-a-01', 1);
    expect(verify(km, 'ack-v1', ack?.payload as Buffer, ack?.signature as string)).toBe(true);

    const row = (await q('SELECT * FROM audit_logs WHERE entry_id = $1', [record.entry_id]))[0];
    expect(row).toMatchObject({
      workstation_id: ws,
      outcome: 'granted',
      reason: 'granted',
      detail: null,
      reader_raw: null,
      target_os_username: 'student',
      data_version: '12',
      matched_schedule_ids: ['3a9d5e10-2b4c-4d6e-8f10-1a2b3c4d5e6f'],
      user_snapshot: { id: user, external_id: 'SV001', full_name: 'Nguyễn Văn A' },
      card_snapshot: { id: card, status: 'active' },
      workstation_snapshot: { id: ws, mqtt_identity: 'lab-a-01', hostname: 'host-01', zone: { id: zone, name: 'Lab A' } },
    });
    expect(new Date(row.occurred_at).getTime()).toBe(T0 * 1000);
    const vault = loadUidVault(testKeysDir(), 'k1');
    expect(row.card_uid_index).toBe(vault.index('1F0820CF'));
    expect(vault.decrypt({ ciphertext: row.card_uid_encrypted, iv: row.card_uid_iv, authTag: row.card_uid_auth_tag, keyId: row.encryption_key_id })).toBe('1F0820CF');
    expect(JSON.stringify(row.user_snapshot) + JSON.stringify(row.workstation_snapshot)).not.toContain('1F0820CF');

    // The same batch again (lost ACK): nothing new, acknowledged again.
    const again = await ingest.handleOutbox('lab-a-01', raw);
    expect(again).toMatchObject({ applied: 0, duplicates: 1, rejected: 0 });
    expect(again.ack?.payload.equals(ack?.payload as Buffer)).toBe(true);
    expect(await count('audit_logs')).toBe(1);
  });

  it('stores records without a card UID or without a user as they are', async () => {
    const unknown = swipe({ outcome: 'denied', reason: 'unknown_card', card_uid: '04A32B1C5D6E80', user: null, card: null, target_os_username: null, matched_schedule_ids: [] });
    const failed = swipe({ outcome: 'error', reason: 'reader_error', card_uid: null, reader_raw: 'SCARD_E_NO_SMARTCARD', user: null, card: null, target_os_username: null, matched_schedule_ids: [] });
    expect(await ingest.handleOutbox('lab-a-01', batch([unknown, failed]))).toMatchObject({ applied: 2, rejected: 0 });
    const rows = await q('SELECT outcome, reason, card_uid_index IS NOT NULL AS has_uid, reader_raw, user_snapshot, matched_schedule_ids FROM audit_logs WHERE entry_id = ANY($1) ORDER BY outcome', [
      [unknown.entry_id, failed.entry_id],
    ]);
    expect(rows).toEqual([
      { outcome: 'denied', reason: 'unknown_card', has_uid: true, reader_raw: null, user_snapshot: null, matched_schedule_ids: [] },
      { outcome: 'error', reason: 'reader_error', has_uid: false, reader_raw: 'SCARD_E_NO_SMARTCARD', user_snapshot: null, matched_schedule_ids: [] },
    ]);
  });

  it('opens and closes a session from the reports of the workstation', async () => {
    const decision = swipe({}, T0 + 100);
    const id = randomUUID();
    const result = await ingest.handleOutbox('lab-a-01', batch([decision, started(id, decision.entry_id, T0 + 105)]));
    expect(result).toMatchObject({ applied: 2, rejected: 0 });
    expect(await session(id)).toEqual({ status: 'active', end_reason: null, end_source: null, started: T0 + 105, ended: null });
    const list = (await (await api.call('GET', '/workstations')).json()) as { current_session: { user: { external_id: string } } | null }[];
    expect(list[0].current_session?.user.external_id).toBe('SV001');

    const close = ended(id, T0 + 900, { status: 'forced_logout', end_reason: 'schedule_expired' });
    expect(await ingest.handleOutbox('lab-a-01', batch([close]))).toMatchObject({ applied: 1 });
    expect(await session(id)).toEqual({ status: 'forced_logout', end_reason: 'schedule_expired', end_source: 'reported', started: T0 + 105, ended: T0 + 900 });
    // A second report for a session that was really reported is not applied (INV-007).
    expect(await ingest.handleOutbox('lab-a-01', batch([ended(id, T0 + 950)]))).toMatchObject({ applied: 0, duplicates: 1, rejected: 0 });
    expect((await session(id)).ended).toBe(T0 + 900);
  });

  it('closes a session the server still thinks active when the workstation starts a new one, and lets the real report replace that once (D-015)', async () => {
    const a = randomUUID();
    const b = randomUUID();
    const da = swipe({}, T0 + 1000);
    const db = swipe({}, T0 + 2000);
    await ingest.handleOutbox('lab-a-01', batch([da, started(a, da.entry_id, T0 + 1005)]));
    const startB = started(b, db.entry_id, T0 + 2005);
    expect(await ingest.handleOutbox('lab-a-01', batch([db, startB]))).toMatchObject({ applied: 2, rejected: 0 });
    expect(await session(a)).toEqual({ status: 'abandoned', end_reason: 'os_session_lost', end_source: 'inferred', started: T0 + 1005, ended: T0 + 2005 });
    expect((await session(b)).status).toBe('active');

    // The start of B resent later must not close anything.
    expect(await ingest.handleOutbox('lab-a-01', batch([startB]))).toMatchObject({ applied: 0, duplicates: 1 });
    expect((await session(b)).status).toBe('active');

    // The real end of A arrives late: it replaces the inferred one, once.
    expect(await ingest.handleOutbox('lab-a-01', batch([ended(a, T0 + 1500)]))).toMatchObject({ applied: 1 });
    expect(await session(a)).toEqual({ status: 'completed', end_reason: 'user_logout', end_source: 'reported', started: T0 + 1005, ended: T0 + 1500 });
    expect(await ingest.handleOutbox('lab-a-01', batch([ended(a, T0 + 1600)]))).toMatchObject({ applied: 0, duplicates: 1 });
    expect((await session(a)).ended).toBe(T0 + 1500);
    await ingest.handleOutbox('lab-a-01', batch([ended(b, T0 + 2500)]));
  });

  it('stores alerts from the workstation', async () => {
    const alert = { entry_id: randomUUID(), occurred_at: T0 + 3000, event_type: 'security_alert', payload: { kind: 'edge_db_recovered', detail: { lost_outbox_entries: 3 } } };
    const bare = { entry_id: randomUUID(), occurred_at: T0 + 3001, event_type: 'security_alert', payload: { kind: 'snapshot_signature_invalid', detail: null } };
    expect(await ingest.handleOutbox('lab-a-01', batch([alert, bare]))).toMatchObject({ applied: 2, rejected: 0 });
    expect(await ingest.handleOutbox('lab-a-01', batch([alert]))).toMatchObject({ applied: 0, duplicates: 1 });
    expect(await q('SELECT kind, detail FROM workstation_alerts ORDER BY occurred_at')).toEqual([
      { kind: 'edge_db_recovered', detail: { lost_outbox_entries: 3 } },
      { kind: 'snapshot_signature_invalid', detail: null },
    ]);
  });

  it('keeps records it cannot apply as rejects, applies the rest and still acknowledges the whole batch', async () => {
    const before = { audit: await count('audit_logs'), rejects: await count('ingest_rejects') };
    const good1 = swipe({}, T0 + 4000);
    const good2 = swipe({ outcome: 'noop', reason: 'already_active' }, T0 + 4010);
    const bad: Record<string, unknown>[] = [
      { entry_id: randomUUID(), occurred_at: T0 + 4001, event_type: 'telemetry', payload: {} },
      swipe({ outcome: 'maybe' }, T0 + 4002),
      swipe({ card_uid: 'XYZ' }, T0 + 4003),
      ended(randomUUID(), T0 + 4004),
      started(randomUUID(), randomUUID(), T0 + 4005),
      { entry_id: 'not-a-uuid', occurred_at: T0 + 4006, event_type: 'security_alert', payload: { kind: 'edge_db_recovered', detail: null } },
      { entry_id: randomUUID(), occurred_at: T0 + 4007, event_type: 'security_alert', payload: { kind: 'made_up', detail: null } },
      { entry_id: randomUUID(), occurred_at: 'yesterday', event_type: 'swipe_decision', payload: {} },
    ];
    // The fifth bad record names a user that does not exist.
    (bad[4].payload as Record<string, unknown>).user_id = randomUUID();
    const raw = batch([good1, ...bad, good2]);
    const result = await ingest.handleOutbox('lab-a-01', raw);
    expect(result).toMatchObject({ applied: 2, duplicates: 0, rejected: bad.length });
    expect(JSON.parse((result.ack?.payload as Buffer).toString('utf8')).acked_seq).toBe(seq);
    expect(await count('audit_logs')).toBe(before.audit + 2);
    const rejects = await q('SELECT entry_id, outbox_seq::int AS outbox_seq, raw_record, error FROM ingest_rejects ORDER BY outbox_seq');
    expect(rejects).toHaveLength(before.rejects + bad.length);
    expect(rejects.map((r) => r.raw_record.event_type)).toEqual(bad.map((r) => r.event_type));
    expect(rejects[0].error).toMatch(/unknown event_type telemetry/);
    expect(rejects[2].error).toMatch(/card_uid/);
    expect(rejects[3].error).toMatch(/does not know/);
    for (const reject of rejects) expect(reject.error.length).toBeGreaterThan(0);

    // The batch again: applied records are duplicates, rejects are not stored twice.
    expect(await ingest.handleOutbox('lab-a-01', raw)).toMatchObject({ applied: 0, duplicates: 2, rejected: bad.length });
    expect(await count('ingest_rejects')).toBe(before.rejects + bad.length);
    const flags = ((await (await api.call('GET', '/workstations')).json()) as { flags: string[] }[])[0].flags;
    expect(flags).toEqual(expect.arrayContaining(['ingest_rejects', 'security_alert']));
  });
});
