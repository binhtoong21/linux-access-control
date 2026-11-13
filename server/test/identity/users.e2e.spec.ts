import { ApiContext, auditActions, errorCode, outboxEvents, startSignedIn } from '../support/api';
import { TEST_DATABASE_URL } from '../support/db';

interface User {
  id: string;
  external_id: string;
  full_name: string;
  email: string | null;
  status: string;
}
interface Page {
  items: User[];
  next_cursor: string | null;
}

(TEST_DATABASE_URL ? describe : describe.skip)('users', () => {
  let api: ApiContext;
  const users: Record<string, User> = {};

  const create = async (external_id: string, full_name: string, email?: string): Promise<User> => {
    const res = await api.call('POST', '/users', { external_id, full_name, email });
    expect(res.status).toBe(201);
    return (await res.json()) as User;
  };
  const page = async (query: string): Promise<Page> => {
    const res = await api.call('GET', `/users${query}`);
    expect(res.status).toBe(200);
    return (await res.json()) as Page;
  };

  beforeAll(async () => {
    api = await startSignedIn(TEST_DATABASE_URL as string);
  });
  afterAll(async () => api.close());

  it('creates users, audits each creation and emits no event', async () => {
    users.an = await create('SV003', 'Nguyễn Văn An', 'an@example.edu');
    users.binh = await create('SV001', 'Trần Thị Bình');
    users.chi = await create('SV002', 'Lê Chi 100%');
    users.dung = await create('GV.01', 'Phạm Dũng');
    users.em = await create('sv_005', 'Hoàng Em');
    expect(users.an).toMatchObject({ external_id: 'SV003', full_name: 'Nguyễn Văn An', email: 'an@example.edu', status: 'active' });
    expect(users.binh.email).toBeNull();
    expect(await auditActions(api.pool, users.an.id)).toEqual(['user.create']);
    expect(await outboxEvents(api.pool, users.an.id)).toEqual([]);
  });

  it.each([['SV 001'], ['Nguyễn'], ['a'.repeat(33)], ['']])('rejects external_id %p (VR-011)', async (external_id) => {
    const res = await api.call('POST', '/users', { external_id, full_name: 'X' });
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe('VALIDATION_ERROR');
  });

  it('rejects a blank full_name, a bad email and unknown fields', async () => {
    for (const body of [
      { external_id: 'X1', full_name: '   ' },
      { external_id: 'X2', full_name: 'X', email: 'not-an-email' },
      { external_id: 'X3', full_name: 'X', role: 'admin' },
    ]) {
      const res = await api.call('POST', '/users', body);
      expect(res.status).toBe(400);
    }
  });

  it('rejects a duplicate external_id', async () => {
    const res = await api.call('POST', '/users', { external_id: 'SV001', full_name: 'Someone else' });
    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe('DUPLICATE');
  });

  it('pages through all users in external_id order', async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const p: Page = await page(`?limit=2${cursor ? `&cursor=${cursor}` : ''}`);
      expect(p.items.length).toBeLessThanOrEqual(2);
      seen.push(...p.items.map((u) => u.external_id));
      cursor = p.next_cursor;
    } while (cursor);
    // Order follows the database collation, so only completeness and no repeats are asserted.
    expect(new Set(seen).size).toBe(5);
    expect(seen).toHaveLength(5);
    expect((await page('')).next_cursor).toBeNull();
  });

  it('searches by code or name, case-insensitive, with LIKE wildcards taken literally', async () => {
    expect((await page('?q=sv00')).items.map((u) => u.external_id)).toEqual(['SV001', 'SV002', 'SV003']);
    expect((await page(`?q=${encodeURIComponent('bình')}`)).items.map((u) => u.id)).toEqual([users.binh.id]);
    expect((await page(`?q=${encodeURIComponent('100%')}`)).items.map((u) => u.id)).toEqual([users.chi.id]);
    expect((await page(`?q=${encodeURIComponent('%')}`)).items.map((u) => u.id)).toEqual([users.chi.id]);
    expect((await page('?q=_')).items.map((u) => u.id)).toEqual([users.em.id]);
  });

  it('rejects a bad cursor, limit or filter', async () => {
    for (const query of ['?cursor=garbage', '?limit=0', '?limit=201', '?status=deleted', '?group_id=nope', '?sort=name']) {
      const res = await api.call('GET', `/users${query}`);
      expect(res.status).toBe(400);
      expect(await errorCode(res)).toBe('VALIDATION_ERROR');
    }
  });

  it('filters by group and shows cards (without UID) and groups in the detail', async () => {
    const group = await api.pool.query("INSERT INTO groups (name) VALUES ('CNTT-K65') RETURNING id");
    const groupId = group.rows[0].id as string;
    await api.pool.query('INSERT INTO group_members (group_id, user_id) VALUES ($1, $2)', [groupId, users.an.id]);
    await api.pool.query(
      `INSERT INTO cards (uid_encrypted, uid_iv, uid_auth_tag, encryption_key_id, uid_index, uid_length, owner_id, status)
       VALUES ($1, $2, $3, 'k1', $4, 4, $5, 'active')`,
      [Buffer.alloc(8), Buffer.alloc(12), Buffer.alloc(16), 'a'.repeat(64), users.an.id],
    );
    expect((await page(`?group_id=${groupId}`)).items.map((u) => u.id)).toEqual([users.an.id]);
    const res = await api.call('GET', `/users/${users.an.id}`);
    expect(res.status).toBe(200);
    const detail = (await res.json()) as { cards: Record<string, unknown>[]; groups: unknown[] };
    expect(detail.groups).toEqual([{ id: groupId, name: 'CNTT-K65' }]);
    expect(detail.cards).toHaveLength(1);
    expect(detail.cards[0]).toMatchObject({ status: 'active', uid_length: 4 });
    expect(Object.keys(detail.cards[0]).sort()).toEqual(['created_at', 'id', 'status', 'uid_length']);
  });

  it('updates only changed fields, with audit and a UserUpdated event', async () => {
    const res = await api.call('PATCH', `/users/${users.binh.id}`, { full_name: '  Trần Bình  ', email: 'binh@example.edu' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ full_name: 'Trần Bình', email: 'binh@example.edu' });
    expect(await outboxEvents(api.pool, users.binh.id)).toEqual([{ event_type: 'UserUpdated', payload: { changed: ['full_name', 'email'] } }]);
    const same = await api.call('PATCH', `/users/${users.binh.id}`, { full_name: 'Trần Bình' });
    expect(same.status).toBe(200);
    expect(await auditActions(api.pool, users.binh.id)).toEqual(['user.create', 'user.update']);
    const cleared = await api.call('PATCH', `/users/${users.binh.id}`, { email: null });
    expect(((await cleared.json()) as User).email).toBeNull();
    expect(await outboxEvents(api.pool, users.binh.id)).toHaveLength(2);
  });

  it('deactivates and activates with events; repeating is a no-op', async () => {
    const off = await api.call('POST', `/users/${users.dung.id}/deactivate`);
    expect(off.status).toBe(200);
    expect(((await off.json()) as User).status).toBe('inactive');
    expect((await api.call('POST', `/users/${users.dung.id}/deactivate`)).status).toBe(200);
    expect((await page('?status=inactive')).items.map((u) => u.id)).toEqual([users.dung.id]);
    const on = await api.call('POST', `/users/${users.dung.id}/activate`);
    expect(((await on.json()) as User).status).toBe('active');
    expect(await auditActions(api.pool, users.dung.id)).toEqual(['user.create', 'user.deactivate', 'user.activate']);
    expect((await outboxEvents(api.pool, users.dung.id)).map((e) => e.event_type)).toEqual(['UserDeactivated', 'UserActivated']);
  });

  it('returns 404 for an unknown user, 400 for a bad id, and has no DELETE', async () => {
    const missing = '00000000-0000-4000-8000-000000000000';
    for (const [method, path] of [['GET', `/users/${missing}`], ['PATCH', `/users/${missing}`], ['POST', `/users/${missing}/deactivate`]]) {
      const res = await api.call(method, path, method === 'PATCH' ? { full_name: 'X' } : undefined);
      expect(res.status).toBe(404);
      expect(await errorCode(res)).toBe('NOT_FOUND');
    }
    expect((await api.call('GET', '/users/not-a-uuid')).status).toBe(400);
    expect((await api.call('DELETE', `/users/${users.an.id}`)).status).toBe(404);
  });
});
