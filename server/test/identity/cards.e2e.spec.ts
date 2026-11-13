import { loadUidVault } from '../../src/shared/crypto/uid-vault';
import { ApiContext, auditActions, errorCode, outboxEvents, startSignedIn } from '../support/api';
import { TEST_DATABASE_URL } from '../support/db';
import { testKeysDir } from '../support/keys';

interface Card {
  id: string;
  status: string;
  uid_length: number;
  owner: { id: string; external_id: string } | null;
  uid?: string;
}

const TEST_UIDS = ['1F0820CF', '04A1B2C3D4E5F6', 'A1B2C3D4', '08A1B2C3', '08112233', 'B1B2B3B4'];

(TEST_DATABASE_URL ? describe : describe.skip)('cards', () => {
  let api: ApiContext;
  let alice: string;
  let bob: string;
  let main: Card;
  let wsId: string;
  const missing = '00000000-0000-4000-8000-000000000000';

  const json = async <T>(res: Response, status: number): Promise<T> => {
    expect(res.status).toBe(status);
    return (await res.json()) as T;
  };
  const register = (body: Record<string, unknown>) => api.call('POST', '/cards', body);
  /** Inserts an audit entry the way ingest (M3) will store it: UID encrypted with the server key. */
  const auditEntry = async (uid: string, reason = 'unknown_card'): Promise<string> => {
    const vault = loadUidVault(testKeysDir(), 'k1');
    const enc = vault.encrypt(uid);
    const res = await api.pool.query(
      `INSERT INTO audit_logs (entry_id, occurred_at, workstation_id, outcome, reason, card_uid_encrypted, card_uid_iv,
         card_uid_auth_tag, encryption_key_id, card_uid_index, workstation_snapshot)
       VALUES (gen_random_uuid(), now(), $1, 'denied', $2, $3, $4, $5, $6, $7, '{}') RETURNING entry_id`,
      [wsId, reason, enc.ciphertext, enc.iv, enc.authTag, enc.keyId, vault.index(uid)],
    );
    return res.rows[0].entry_id as string;
  };

  beforeAll(async () => {
    api = await startSignedIn(TEST_DATABASE_URL as string);
    alice = (await json<{ id: string }>(await api.call('POST', '/users', { external_id: 'SV001', full_name: 'Alice' }), 201)).id;
    bob = (await json<{ id: string }>(await api.call('POST', '/users', { external_id: 'SV002', full_name: 'Bob' }), 201)).id;
    const ws = await api.pool.query(
      "INSERT INTO workstations (mqtt_identity, machine_id, mac_address, hostname, public_key) VALUES ('ws-01', 'm-01', '00:11:22:33:44:55', 'ws-01', 'pk') RETURNING id",
    );
    wsId = ws.rows[0].id;
  });
  afterAll(async () => api.close());

  it('registers a new card: 201, normalized, stored encrypted, audited and announced', async () => {
    main = await json<Card>(await register({ uid: '1f:08:20:cf', user_id: alice }), 201);
    expect(main).toMatchObject({ status: 'active', uid_length: 4, owner: { id: alice, external_id: 'SV001' } });
    expect(main).not.toHaveProperty('uid');
    const row = await api.pool.query('SELECT uid_index, uid_encrypted, encryption_key_id FROM cards WHERE id = $1', [main.id]);
    expect(row.rows[0].uid_index).toBe(loadUidVault(testKeysDir(), 'k1').index('1F0820CF'));
    expect(row.rows[0].encryption_key_id).toBe('k1');
    expect((row.rows[0].uid_encrypted as Buffer).toString('latin1')).not.toContain('1F0820CF');
    expect(await auditActions(api.pool, main.id)).toEqual(['card.register']);
    expect(await outboxEvents(api.pool, main.id)).toEqual([{ event_type: 'CardBound', payload: { owner_id: alice, previous_owner_id: null } }]);
  });

  it('is a no-op for the same owner and refuses another owner (INV-001)', async () => {
    expect((await json<Card>(await register({ uid: '1F0820CF', user_id: alice }), 200)).id).toBe(main.id);
    const taken = await register({ uid: '1F0820CF', user_id: bob });
    expect(taken.status).toBe(409);
    expect(await errorCode(taken)).toBe('CARD_ALREADY_BOUND');
    expect(await auditActions(api.pool, main.id)).toEqual(['card.register']);
  });

  it('rejects malformed and random UIDs before touching the database', async () => {
    for (const uid of ['XYZ', '0102', '01020304050607080910111213']) {
      const res = await register({ uid, user_id: alice });
      expect(res.status).toBe(400);
      expect(await errorCode(res)).toBe('INVALID_UID');
    }
    const random = await register({ uid: '08A1B2C3', user_id: alice });
    expect(random.status).toBe(400);
    expect(await errorCode(random)).toBe('RANDOM_UID_NOT_SUPPORTED');
    expect((await api.pool.query('SELECT 1 FROM cards')).rowCount).toBe(1);
  });

  it('needs exactly one UID source and an existing user', async () => {
    for (const body of [{ user_id: alice }, { uid: 'B1B2B3B4', from_audit_entry_id: missing, user_id: alice }]) {
      const res = await register(body);
      expect(res.status).toBe(400);
      expect(await errorCode(res)).toBe('VALIDATION_ERROR');
    }
    const noUser = await register({ uid: 'B1B2B3B4', user_id: missing });
    expect(noUser.status).toBe(404);
  });

  it('shows the decrypted UID only in the detail', async () => {
    expect((await json<Card>(await api.call('GET', `/cards/${main.id}`), 200)).uid).toBe('1F0820CF');
    const page = await json<{ items: Record<string, unknown>[] }>(await api.call('GET', '/cards'), 200);
    expect(page.items).toHaveLength(1);
    expect(Object.keys(page.items[0]).some((k) => k.startsWith('uid') && k !== 'uid_length')).toBe(false);
    const user = await json<{ cards: Record<string, unknown>[] }>(await api.call('GET', `/users/${alice}`), 200);
    expect(user.cards.map((c) => c.id)).toEqual([main.id]);
  });

  it('looks cards up by UID through the blind index, by owner and by status', async () => {
    const byUid = await json<{ items: Card[] }>(await api.call('GET', '/cards?uid=1f0820cf'), 200);
    expect(byUid.items.map((c) => c.id)).toEqual([main.id]);
    expect((await json<{ items: Card[] }>(await api.call('GET', '/cards?uid=B1B2B3B4'), 200)).items).toEqual([]);
    const bad = await api.call('GET', '/cards?uid=zz');
    expect(bad.status).toBe(400);
    expect(await errorCode(bad)).toBe('INVALID_UID');
    expect((await json<{ items: Card[] }>(await api.call('GET', `/cards?user_id=${bob}`), 200)).items).toEqual([]);
    expect((await json<{ items: Card[] }>(await api.call('GET', '/cards?status=active'), 200)).items).toHaveLength(1);
  });

  it('disables and enables; repeating is a no-op', async () => {
    expect((await json<Card>(await api.call('POST', `/cards/${main.id}/disable`), 200)).status).toBe('disabled');
    expect((await json<Card>(await api.call('POST', `/cards/${main.id}/disable`), 200)).status).toBe('disabled');
    expect((await json<Card>(await api.call('POST', `/cards/${main.id}/enable`), 200)).status).toBe('active');
    expect((await outboxEvents(api.pool, main.id)).slice(1)).toEqual([
      { event_type: 'CardDisabled', payload: { owner_id: alice } },
      { event_type: 'CardEnabled', payload: { owner_id: alice } },
    ]);
  });

  it('unbinds a disabled card, refuses enable on unbound, and rebinding by UID gives active', async () => {
    await json(await api.call('POST', `/cards/${main.id}/disable`), 200);
    const unbound = await json<Card>(await api.call('POST', `/cards/${main.id}/unbind`), 200);
    expect(unbound).toMatchObject({ status: 'unbound', owner: null });
    expect((await json<Card>(await api.call('POST', `/cards/${main.id}/unbind`), 200)).status).toBe('unbound');
    const enable = await api.call('POST', `/cards/${main.id}/enable`);
    expect(enable.status).toBe(409);
    expect(await errorCode(enable)).toBe('INVALID_STATE_TRANSITION');
    const rebound = await json<Card>(await register({ uid: '1F0820CF', user_id: bob }), 200);
    expect(rebound).toMatchObject({ id: main.id, status: 'active', owner: { id: bob } });
    const events = await outboxEvents(api.pool, main.id);
    expect(events.slice(-2)).toEqual([
      { event_type: 'CardUnbound', payload: { owner_id: null, previous_owner_id: alice } },
      { event_type: 'CardBound', payload: { owner_id: bob, previous_owner_id: null } },
    ]);
    expect(await auditActions(api.pool, main.id)).toEqual([
      'card.register', 'card.disable', 'card.enable', 'card.disable', 'card.unbind', 'card.bind',
    ]);
  });

  it('binds an unbound card through /bind and refuses to move a bound card', async () => {
    const second = await json<Card>(await register({ uid: '04A1B2C3D4E5F6', user_id: alice }), 201);
    expect(second.uid_length).toBe(7);
    await json(await api.call('POST', `/cards/${second.id}/unbind`), 200);
    expect((await json<Card>(await api.call('POST', `/cards/${second.id}/bind`, { user_id: bob }), 200)).owner?.id).toBe(bob);
    expect((await json<Card>(await api.call('POST', `/cards/${second.id}/bind`, { user_id: bob }), 200)).owner?.id).toBe(bob);
    const move = await api.call('POST', `/cards/${second.id}/bind`, { user_id: alice });
    expect(move.status).toBe(409);
    expect(await errorCode(move)).toBe('INVALID_STATE_TRANSITION');
    expect((await api.call('POST', `/cards/${second.id}/bind`, { user_id: missing })).status).toBe(404);
  });

  it('registers from an unknown_card audit entry (FR-073), still refusing random UIDs', async () => {
    const card = await json<Card>(await register({ from_audit_entry_id: await auditEntry('A1B2C3D4'), user_id: alice }), 201);
    expect((await json<Card>(await api.call('GET', `/cards/${card.id}`), 200)).uid).toBe('A1B2C3D4');
    const random = await register({ from_audit_entry_id: await auditEntry('08112233'), user_id: alice });
    expect(random.status).toBe(400);
    expect(await errorCode(random)).toBe('RANDOM_UID_NOT_SUPPORTED');
    const wrongReason = await register({ from_audit_entry_id: await auditEntry('B1B2B3B4', 'outside_schedule'), user_id: alice });
    expect(wrongReason.status).toBe(400);
    expect(await errorCode(wrongReason)).toBe('VALIDATION_ERROR');
    expect((await register({ from_audit_entry_id: missing, user_id: alice })).status).toBe(404);
  });

  it('pages newest first without repeats', async () => {
    for (const uid of ['C1C2C3C4', 'C1C2C3C5', 'C1C2C3C6']) await json(await register({ uid, user_id: bob }), 201);
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page: { items: Card[]; next_cursor: string | null } = await json(
        await api.call('GET', `/cards?limit=2${cursor ? `&cursor=${cursor}` : ''}`),
        200,
      );
      seen.push(...page.items.map((c) => c.id));
      cursor = page.next_cursor;
    } while (cursor);
    expect(seen).toHaveLength(6);
    expect(new Set(seen).size).toBe(6);
    expect(seen[seen.length - 1]).toBe(main.id);
    const bad = await api.call('GET', `/cards?cursor=${Buffer.from(JSON.stringify(['x', 'y'])).toString('base64url')}`);
    expect(bad.status).toBe(400);
  });

  it('never writes a raw UID into admin audit or outbox', async () => {
    const audit = await api.pool.query("SELECT coalesce(before::text, '') || coalesce(after::text, '') AS t FROM admin_audit_logs");
    const outbox = await api.pool.query('SELECT payload::text AS t FROM server_outbox');
    const text = [...audit.rows, ...outbox.rows].map((r: { t: string }) => r.t.toUpperCase()).join('\n');
    for (const uid of [...TEST_UIDS, 'C1C2C3C4']) expect(text).not.toContain(uid);
  });

  it('returns 404 for an unknown card and 400 for a bad id', async () => {
    for (const path of [`/cards/${missing}`, `/cards/${missing}/disable`, `/cards/${missing}/unbind`]) {
      const res = await api.call(path.endsWith(missing) ? 'GET' : 'POST', path);
      expect(res.status).toBe(404);
      expect(await errorCode(res)).toBe('NOT_FOUND');
    }
    expect((await api.call('GET', '/cards/not-a-uuid')).status).toBe(400);
  });
});
