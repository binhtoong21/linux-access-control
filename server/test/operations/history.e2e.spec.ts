import { randomUUID } from 'node:crypto';
import { IngestService } from '../../src/operations/ingest.service';
import { deriveKm, sign } from '../../src/shared/crypto/crypto-v1';
import { loadMasterKey, loadUidVault } from '../../src/shared/crypto/uid-vault';
import { ApiContext, auditActions, errorCode, startSignedIn } from '../support/api';
import { TEST_DATABASE_URL } from '../support/db';
import { testKeysDir } from '../support/keys';

const BOOT = '9f2c8d14-5b1e-4c33-9a70-0d6f2e8b1c47';
const T0 = 1793048000;

interface Page<T> {
  items: T[];
  next_cursor: string | null;
}
interface Audit {
  id: string;
  entry_id: string;
  outcome: string;
  reason: string;
  occurred_at: string;
  has_card_uid: boolean;
  user: { external_id: string } | null;
  workstation: { mqtt_identity: string; zone: { name: string } | null };
}

(TEST_DATABASE_URL ? describe : describe.skip)('history read API', () => {
  let api: ApiContext;
  let ingest: IngestService;
  let user: string;
  let card: string;
  let zone: string;
  let ws1: string;
  let ws2: string;
  let session: string;
  let seq = 0;
  const entries: Record<string, string> = {};

  const json = async <T>(res: Response, status = 200): Promise<T> => {
    expect(res.status).toBe(status);
    return (await res.json()) as T;
  };
  const get = <T>(path: string): Promise<T> => api.call('GET', path).then((res) => json<T>(res));
  /** Every item of a list, following next_cursor with the given page size. */
  const all = async <T>(path: string, limit: number): Promise<T[]> => {
    const out: T[] = [];
    let cursor: string | null = null;
    do {
      const sep = path.includes('?') ? '&' : '?';
      const page: Page<T> = await get(`${path}${sep}limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      out.push(...page.items);
      cursor = page.next_cursor;
    } while (cursor);
    return out;
  };
  const masterKey = loadMasterKey(testKeysDir());
  const send = async (identity: string, records: Record<string, unknown>[]): Promise<void> => {
    const numbered = records.map((r) => ({ outbox_seq: (seq += 1), ...r }));
    const raw = Buffer.from(
      JSON.stringify({ schema: 'outbox-v1', workstation_id: identity, batch_id: `b-${seq}`, from_seq: numbered[0].outbox_seq, to_seq: seq, records: numbered }),
    );
    const sig = sign(deriveKm(masterKey, identity, 1), 'outbox-v1', raw);
    await ingest.handleOutbox(identity, raw, sig);
  };
  const swipe = (name: string, at: number, payload: Record<string, unknown> = {}) => {
    entries[name] = randomUUID();
    return {
      entry_id: entries[name],
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
        matched_schedule_ids: [],
        data_version: 3,
        ...payload,
      },
    };
  };
  const alert = (at: number) => ({ entry_id: randomUUID(), occurred_at: at, event_type: 'security_alert', payload: { kind: 'edge_db_recovered', detail: null } });
  const iso = (t: number) => new Date(t * 1000).toISOString();

  beforeAll(async () => {
    api = await startSignedIn(TEST_DATABASE_URL as string);
    ingest = api.ctx.app.get(IngestService, { strict: false });
    const post = async (path: string, body: unknown): Promise<string> => (await json<{ id: string }>(await api.call('POST', path, body), 201)).id;
    zone = await post('/zones', { name: 'Lab A', location: 'B1-201' });
    user = await post('/users', { external_id: 'SV001', full_name: 'Nguyễn Văn A' });
    card = await post('/cards', { uid: '1F0820CF', user_id: user });
    const ws = async (identity: string, mac: string, zoneId: string | null): Promise<string> =>
      (
        await api.pool.query(
          `INSERT INTO workstations (mqtt_identity, machine_id, mac_address, hostname, public_key, zone_id) VALUES ($1, $1, $2, $1, 'pk', $3) RETURNING id`,
          [identity, mac, zoneId],
        )
      ).rows[0].id;
    ws1 = await ws('lab-a-01', '02:00:00:00:00:01', zone);
    ws2 = await ws('lab-b-01', '02:00:00:00:00:02', null);
    session = randomUUID();
    const granted = swipe('granted', T0);
    await send('lab-a-01', [
      granted,
      {
        entry_id: randomUUID(),
        occurred_at: T0 + 5,
        event_type: 'session_started',
        payload: { session_id: session, decision_entry_id: granted.entry_id, user_id: user, card_id: card, os_username: 'student', boot_id: BOOT, decided_at: T0, started_at: T0 + 5, expires_at: T0 + 3600 },
      },
      swipe('unknown', T0 + 10, { outcome: 'denied', reason: 'unknown_card', card_uid: '04A32B1C5D6E80', user: null, card: null, target_os_username: null }),
      swipe('error', T0 + 20, { outcome: 'error', reason: 'reader_error', card_uid: null, reader_raw: 'SCARD_E_TIMEOUT', user: null, card: null, target_os_username: null }),
      alert(T0 + 40),
      alert(T0 + 40),
      alert(T0 + 40),
      swipe('rejected', T0 + 50, { outcome: 'maybe' }),
    ]);
    await send('lab-b-01', [swipe('other', T0 + 30)]);
  });
  afterAll(async () => api.close());

  it('lists audit records newest first without any card UID', async () => {
    const page = await get<Page<Audit>>('/audit-logs');
    expect(page.next_cursor).toBeNull();
    expect(page.items.map((a) => a.entry_id)).toEqual([entries.other, entries.error, entries.unknown, entries.granted]);
    expect(page.items.map((a) => a.has_card_uid)).toEqual([true, false, true, true]);
    expect(page.items[3]).toMatchObject({
      outcome: 'granted',
      user: { external_id: 'SV001' },
      workstation: { mqtt_identity: 'lab-a-01', zone: { name: 'Lab A' } },
      occurred_at: iso(T0),
    });
    const text = JSON.stringify(page);
    expect(text).not.toContain('1F0820CF');
    expect(text).not.toContain('04A32B1C5D6E80');
    expect(page.items.every((a) => !('card_uid' in a))).toBe(true);
  });

  it('filters audit records', async () => {
    const ids = async (query: string): Promise<string[]> => (await get<Page<Audit>>(`/audit-logs?${query}`)).items.map((a) => a.entry_id);
    expect(await ids(`workstation_id=${ws1}`)).toEqual([entries.error, entries.unknown, entries.granted]);
    expect(await ids(`workstation_id=${ws2}`)).toEqual([entries.other]);
    expect(await ids(`zone_id=${zone}`)).toEqual([entries.error, entries.unknown, entries.granted]);
    expect(await ids(`user_id=${user}`)).toEqual([entries.other, entries.granted]);
    expect(await ids('outcome=denied')).toEqual([entries.unknown]);
    expect(await ids('reason=reader_error')).toEqual([entries.error]);
    expect(await ids('card_uid=1f:08:20:cf')).toEqual([entries.other, entries.granted]);
    expect(await ids('card_uid=04A32B1C5D6E80')).toEqual([entries.unknown]);
    expect(await ids(`from=${iso(T0 + 10)}&to=${iso(T0 + 30)}`)).toEqual([entries.error, entries.unknown]);
    const bad = await api.call('GET', '/audit-logs?card_uid=zz');
    expect(bad.status).toBe(400);
    expect(await errorCode(bad)).toBe('INVALID_UID');
    for (const query of ['workstation_id=nope', 'outcome=maybe', 'from=yesterday', 'limit=0', 'limit=201', 'cursor=bm9wZQ']) {
      expect([query, (await api.call('GET', `/audit-logs?${query}`)).status]).toEqual([query, 400]);
    }
  });

  it('pages through audit records with the cursor', async () => {
    const one = await get<Page<Audit>>('/audit-logs?limit=1');
    expect(one.items).toHaveLength(1);
    expect(one.next_cursor).not.toBeNull();
    expect((await all<Audit>('/audit-logs', 1)).map((a) => a.entry_id)).toEqual([entries.other, entries.error, entries.unknown, entries.granted]);
    expect((await all<Audit>(`/audit-logs?workstation_id=${ws1}`, 2)).map((a) => a.entry_id)).toEqual([entries.error, entries.unknown, entries.granted]);
  });

  it('shows the decrypted UID only in the detail view', async () => {
    const list = (await get<Page<Audit>>('/audit-logs')).items;
    const granted = list.find((a) => a.entry_id === entries.granted) as Audit;
    const error = list.find((a) => a.entry_id === entries.error) as Audit;
    expect(await get(`/audit-logs/${granted.id}`)).toMatchObject({ entry_id: entries.granted, card_uid: '1F0820CF', reader_raw: null, has_card_uid: true });
    expect(await get(`/audit-logs/${error.id}`)).toMatchObject({ card_uid: null, reader_raw: 'SCARD_E_TIMEOUT', has_card_uid: false });
    expect((await api.call('GET', '/audit-logs/00000000-0000-4000-8000-000000000000')).status).toBe(404);
    expect((await api.call('GET', '/audit-logs/nope')).status).toBe(400);
  });

  it('lists sessions with their user and workstation', async () => {
    const page = await get<Page<Record<string, unknown>>>('/sessions');
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      id: session,
      status: 'active',
      os_username: 'student',
      card_id: card,
      user: { id: user, external_id: 'SV001', full_name: 'Nguyễn Văn A' },
      workstation: { id: ws1, mqtt_identity: 'lab-a-01' },
      started_at: iso(T0 + 5),
      ended_at: null,
    });
    expect(page.items[0]).not.toHaveProperty('sort_time');
    expect((await get<Page<unknown>>(`/sessions?user_id=${user}&status=active`)).items).toHaveLength(1);
    expect((await get<Page<unknown>>('/sessions?status=completed')).items).toHaveLength(0);
    expect((await get<Page<unknown>>(`/sessions?workstation_id=${ws2}`)).items).toHaveLength(0);
    expect((await get<Page<unknown>>(`/sessions?from=${iso(T0 + 6)}`)).items).toHaveLength(0);
    expect((await api.call('GET', '/sessions?status=gone')).status).toBe(400);
  });

  it('pages through alerts that share one timestamp without repeating any', async () => {
    const alerts = await all<{ id: string; kind: string; workstation: { mqtt_identity: string } }>('/workstation-alerts', 1);
    expect(alerts).toHaveLength(3);
    expect(new Set(alerts.map((a) => a.id)).size).toBe(3);
    expect(alerts.every((a) => a.kind === 'edge_db_recovered' && a.workstation.mqtt_identity === 'lab-a-01')).toBe(true);
    expect((await get<Page<unknown>>(`/workstation-alerts?workstation_id=${ws2}`)).items).toHaveLength(0);
    expect((await get<Page<unknown>>(`/workstation-alerts?from=${iso(T0 + 41)}`)).items).toHaveLength(0);
  });

  it('keeps rejected records without the card UID, and resolves them once', async () => {
    const open = await get<Page<{ id: string; raw_record: { payload: Record<string, unknown> }; error: string; outbox_seq: number; resolved_at: string | null }>>(
      '/ingest-rejects',
    );
    expect(open.items).toHaveLength(1);
    const reject = open.items[0];
    expect(reject.resolved_at).toBeNull();
    expect(typeof reject.outbox_seq).toBe('number');
    expect(reject.raw_record.payload.card_uid).toBe('[redacted]');
    expect(reject.raw_record.payload.card_uid_index).toBe(loadUidVault(testKeysDir(), 'k1').index('1F0820CF'));
    expect(JSON.stringify(open)).not.toContain('1F0820CF');
    const stored = (await api.pool.query('SELECT raw_record::text AS raw FROM ingest_rejects')).rows[0].raw;
    expect(stored).not.toContain('1F0820CF');

    const resolved = await json<{ resolved_at: string; note: string }>(await api.call('POST', `/ingest-rejects/${reject.id}/resolve`, { note: 'dữ liệu lỗi từ bản Agent cũ' }));
    expect(resolved.note).toBe('dữ liệu lỗi từ bản Agent cũ');
    const again = await json<{ resolved_at: string; note: string }>(await api.call('POST', `/ingest-rejects/${reject.id}/resolve`, { note: 'khác' }));
    expect(again).toEqual(resolved);
    expect((await get<Page<unknown>>('/ingest-rejects')).items).toHaveLength(0);
    expect((await get<Page<unknown>>('/ingest-rejects?resolved=true')).items).toHaveLength(1);
    expect((await get<Page<unknown>>('/ingest-rejects?resolved=all')).items).toHaveLength(1);
    expect((await get<Page<unknown>>(`/ingest-rejects?resolved=all&workstation_id=${ws2}`)).items).toHaveLength(0);
    expect((await api.call('POST', '/ingest-rejects/999999/resolve', {})).status).toBe(404);
    expect((await api.call('POST', '/ingest-rejects/nope/resolve', {})).status).toBe(404);
    const actions = (await api.pool.query("SELECT action, after FROM admin_audit_logs WHERE entity_type = 'ingest_reject'")).rows;
    expect(actions).toEqual([{ action: 'ingest_reject.resolve', after: { id: reject.id, note: 'dữ liệu lỗi từ bản Agent cũ' } }]);
  });

  it('lists admin actions with who did them', async () => {
    const users = await get<Page<{ action: string; entity_id: string; admin: { username: string } }>>('/admin-audit-logs?entity_type=user');
    expect(users.items.map((l) => [l.action, l.entity_id, l.admin.username])).toEqual([['user.create', user, 'root']]);
    expect(await auditActions(api.pool, user)).toEqual(['user.create']);
    const everything = await all<{ id: string; action: string }>('/admin-audit-logs', 2);
    expect(everything.map((l) => l.action)).toEqual(['ingest_reject.resolve', 'card.register', 'user.create', 'zone.create', 'admin.bootstrap']);
    expect((await get<Page<unknown>>(`/admin-audit-logs?entity_id=${zone}`)).items).toHaveLength(1);
    expect((await get<Page<unknown>>(`/admin-audit-logs?admin_id=${api.adminId}`)).items).toHaveLength(5);
    expect((await api.call('GET', '/admin-audit-logs?entity_type=User!')).status).toBe(400);
  });

  it('requires an admin session', async () => {
    for (const path of ['/audit-logs', '/sessions', '/ingest-rejects', '/workstation-alerts', '/admin-audit-logs']) {
      expect((await fetch(`${api.ctx.base}/api/v1${path}`)).status).toBe(401);
    }
  });
});
