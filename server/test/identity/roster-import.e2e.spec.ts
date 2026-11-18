import { ApiContext, errorCode, outboxEvents, startSignedIn } from '../support/api';
import { TEST_DATABASE_URL } from '../support/db';

interface RowIssue {
  code: string;
  message: string;
}

interface RowResult {
  line: number;
  external_id: string;
  action: string;
  groups_added: string[];
  card: string | null;
  errors: RowIssue[];
  warnings: RowIssue[];
}

interface ImportResult {
  applied: boolean;
  summary: {
    rows: number;
    users_created: number;
    users_updated: number;
    users_unchanged: number;
    groups_created: string[];
    memberships_added: number;
    cards_registered: number;
    cards_bound: number;
    errors: number;
    warnings: number;
  };
  ignored_columns: string[];
  rows: RowResult[];
}

(TEST_DATABASE_URL ? describe : describe.skip)('roster-import', () => {
  let api: ApiContext;

  const json = async <T>(res: Response, status: number): Promise<T> => {
    expect(res.status).toBe(status);
    return (await res.json()) as T;
  };

  beforeAll(async () => {
    api = await startSignedIn(TEST_DATABASE_URL as string);
  });
  afterAll(async () => api.close());

  it('1. Dry run of 3 valid rows: applied=false, correct summary, and NOTHING written to database', async () => {
    const suf = Math.random().toString(36).slice(2, 7);
    const u1 = `SV1_${suf}`;
    const u2 = `SV2_${suf}`;
    const u3 = `SV3_${suf}`;
    const g1 = `G1_${suf}`;
    const g2 = `G2_${suf}`;
    const hex12 = Math.random().toString(16).slice(2, 14).padEnd(12, '0').toUpperCase();
    const cardUid1 = `04${hex12}`;

    const csv1 = [
      'external_id,full_name,email,groups,card_uid',
      `${u1},User One,u1@example.com,"${g1}; ${g2}",`,
      `${u2},User Two,,${g1},${cardUid1}`,
      `${u3},User Three,u3@example.com,,`,
    ].join('\n');

    const initialOutboxCount = Number((await api.pool.query('SELECT count(*)::int FROM server_outbox')).rows[0].count);

    const res = await api.call('POST', '/imports/roster', { csv: csv1, apply: false });
    const body = await json<ImportResult>(res, 200);

    expect(body.applied).toBe(false);
    expect(body.summary).toEqual({
      rows: 3,
      users_created: 3,
      users_updated: 0,
      users_unchanged: 0,
      groups_created: [g1, g2],
      memberships_added: 3,
      cards_registered: 1,
      cards_bound: 0,
      errors: 0,
      warnings: 0,
    });
    expect(body.rows).toHaveLength(3);
    expect(body.rows[0]).toMatchObject({ external_id: u1, action: 'create', groups_added: [g1, g2], card: null });
    expect(body.rows[1]).toMatchObject({ external_id: u2, action: 'create', groups_added: [g1], card: 'register' });
    expect(body.rows[2]).toMatchObject({ external_id: u3, action: 'create', groups_added: [], card: null });

    // Verify database was not changed
    const usersCount = Number((await api.pool.query('SELECT count(*)::int FROM users WHERE external_id IN ($1, $2, $3)', [u1, u2, u3])).rows[0].count);
    expect(usersCount).toBe(0);

    const groupsCount = Number((await api.pool.query('SELECT count(*)::int FROM groups WHERE name IN ($1, $2)', [g1, g2])).rows[0].count);
    expect(groupsCount).toBe(0);

    const afterOutboxCount = Number((await api.pool.query('SELECT count(*)::int FROM server_outbox')).rows[0].count);
    expect(afterOutboxCount).toBe(initialOutboxCount);
  });

  it('2. Apply the same CSV: applied=true, writes users, groups, memberships, card, audit, and events', async () => {
    const suf = Math.random().toString(36).slice(2, 7);
    const u1 = `SV1_${suf}`;
    const u2 = `SV2_${suf}`;
    const u3 = `SV3_${suf}`;
    const g1 = `G1_${suf}`;
    const g2 = `G2_${suf}`;
    const hex12 = Math.random().toString(16).slice(2, 14).padEnd(12, '0').toUpperCase();
    const cardUid1 = `04${hex12}`;

    const csv1 = [
      'external_id,full_name,email,groups,card_uid',
      `${u1},User One,u1@example.com,"${g1}; ${g2}",`,
      `${u2},User Two,,${g1},${cardUid1}`,
      `${u3},User Three,u3@example.com,,`,
    ].join('\n');

    const res = await api.call('POST', '/imports/roster', { csv: csv1, apply: true });
    const body = await json<ImportResult>(res, 200);

    expect(body.applied).toBe(true);
    expect(body.summary).toEqual({
      rows: 3,
      users_created: 3,
      users_updated: 0,
      users_unchanged: 0,
      groups_created: [g1, g2],
      memberships_added: 3,
      cards_registered: 1,
      cards_bound: 0,
      errors: 0,
      warnings: 0,
    });

    // Verify in database
    const users = (await api.pool.query('SELECT id, external_id FROM users WHERE external_id IN ($1, $2, $3) ORDER BY external_id', [u1, u2, u3])).rows;
    expect(users).toHaveLength(3);

    const groups = (await api.pool.query('SELECT id, name FROM groups WHERE name IN ($1, $2) ORDER BY name', [g1, g2])).rows;
    expect(groups).toHaveLength(2);

    const memberships = (await api.pool.query('SELECT count(*)::int FROM group_members')).rows[0].count;
    expect(Number(memberships)).toBeGreaterThanOrEqual(3);

    const cards = (await api.pool.query('SELECT id, owner_id FROM cards WHERE owner_id = $1', [users.find((u: { external_id: string }) => u.external_id === u2).id])).rows;
    expect(cards).toHaveLength(1);

    // One roster.import admin audit entry
    const auditRes = await api.pool.query("SELECT * FROM admin_audit_logs WHERE action = 'roster.import' ORDER BY id DESC LIMIT 1");
    expect(auditRes.rowCount).toBe(1);
    expect(auditRes.rows[0].entity_type).toBe('roster');

    // GroupMembershipChanged and CardBound events emitted
    const cardEvents = await outboxEvents(api.pool, cards[0].id);
    expect(cardEvents.some((e) => e.event_type === 'CardBound')).toBe(true);

    const g1Row = groups.find((g: { name: string }) => g.name === g1);
    const g1Events = await outboxEvents(api.pool, g1Row.id);
    expect(g1Events.some((e) => e.event_type === 'GroupMembershipChanged')).toBe(true);

    // 3. Apply the same CSV again → all rows unchanged, groups_added empty, card unchanged, no new events
    const initialOutboxTotal = Number((await api.pool.query('SELECT count(*)::int FROM server_outbox')).rows[0].count);
    const reRes = await api.call('POST', '/imports/roster', { csv: csv1, apply: true });
    const reBody = await json<ImportResult>(reRes, 200);

    expect(reBody.applied).toBe(true);
    expect(reBody.summary).toEqual({
      rows: 3,
      users_created: 0,
      users_updated: 0,
      users_unchanged: 3,
      groups_created: [],
      memberships_added: 0,
      cards_registered: 0,
      cards_bound: 0,
      errors: 0,
      warnings: 0,
    });
    for (const r of reBody.rows) {
      expect(r.action).toBe('unchanged');
      expect(r.groups_added).toEqual([]);
      if (r.external_id === u2) {
        expect(r.card).toBe('unchanged');
      } else {
        expect(r.card).toBeNull();
      }
    }

    const reOutboxTotal = Number((await api.pool.query('SELECT count(*)::int FROM server_outbox')).rows[0].count);
    expect(reOutboxTotal).toBe(initialOutboxTotal);
  });

  it('4. Refuses import when a card belongs to another user; valid row is not created', async () => {
    const suf = Math.random().toString(36).slice(2, 7);
    const uOther = `OTHER_${suf}`;
    const uRow1 = `R1_${suf}`;
    const uValid = `VAL_${suf}`;
    const hex12 = Math.random().toString(16).slice(2, 14).padEnd(12, '0').toUpperCase();
    const cardUidOther = `04${hex12}`;

    // Register card to uOther first
    const otherUser = await json<{ id: string }>(await api.call('POST', '/users', { external_id: uOther, full_name: 'Other User' }), 201);
    await json(await api.call('POST', '/cards', { uid: cardUidOther, user_id: otherUser.id }), 201);

    const csv = [
      'external_id,full_name,card_uid',
      `${uRow1},Row One,${cardUidOther}`,
      `${uValid},Valid User,`,
    ].join('\n');

    const res = await api.call('POST', '/imports/roster', { csv, apply: true });
    const body = await json<ImportResult>(res, 200);

    expect(body.applied).toBe(false);
    expect(body.summary.errors).toBe(1);
    expect(body.rows[0].action).toBe('error');
    expect(body.rows[0].errors).toEqual([
      { code: 'CARD_ALREADY_BOUND', message: expect.stringContaining(uOther) },
    ]);

    // Ensure valid user from row 2 was NOT created
    const validCheck = await api.pool.query('SELECT 1 FROM users WHERE external_id = $1', [uValid]);
    expect(validCheck.rowCount).toBe(0);

    // Row 1 user was NOT created
    const r1Check = await api.pool.query('SELECT 1 FROM users WHERE external_id = $1', [uRow1]);
    expect(r1Check.rowCount).toBe(0);
  });

  it('5. Row-level validation reports all codes correctly', async () => {
    const suf = Math.random().toString(36).slice(2, 7);
    const uDup = `DUP_${suf}`;
    const csv = [
      'external_id,full_name,email,card_uid',
      'invalid/id,Valid Name,,',
      `SV_BADNAME_${suf},"   ",,`,
      `SV_BADEMAIL_${suf},Valid Name,not-an-email,`,
      `SV_RANDOM_${suf},Valid Name,,08112233`,
      `${uDup},Dup One,,`,
      `${uDup},Dup Two,,`,
    ].join('\n');

    const res = await api.call('POST', '/imports/roster', { csv, apply: true });
    const body = await json<ImportResult>(res, 200);

    expect(body.applied).toBe(false);
    expect(body.rows[0].errors.some((e) => e.code === 'INVALID_EXTERNAL_ID')).toBe(true);
    expect(body.rows[1].errors.some((e) => e.code === 'INVALID_FULL_NAME')).toBe(true);
    expect(body.rows[2].errors.some((e) => e.code === 'INVALID_EMAIL')).toBe(true);
    expect(body.rows[3].errors.some((e) => e.code === 'RANDOM_UID_NOT_SUPPORTED')).toBe(true);
    expect(body.rows[5].errors.some((e) => e.code === 'DUPLICATE_IN_FILE')).toBe(true);
  });

  it('6. Existing inactive user gets warning USER_INACTIVE and stays inactive; empty email cell keeps existing email', async () => {
    const suf = Math.random().toString(36).slice(2, 7);
    const uInactive = `INACT_${suf}`;

    const created = await json<{ id: string }>(
      await api.call('POST', '/users', { external_id: uInactive, full_name: 'Old Inactive', email: 'keepme@example.com' }),
      201,
    );
    await api.call('POST', `/users/${created.id}/deactivate`);

    const csv = [
      'external_id,full_name,email',
      `${uInactive},New Inactive Name,`,
    ].join('\n');

    const res = await api.call('POST', '/imports/roster', { csv, apply: true });
    const body = await json<ImportResult>(res, 200);

    expect(body.applied).toBe(true);
    expect(body.rows[0].warnings).toEqual([
      { code: 'USER_INACTIVE', message: expect.any(String) },
    ]);
    expect(body.rows[0].action).toBe('update');

    const userDb = (await api.pool.query('SELECT full_name, email, status FROM users WHERE id = $1', [created.id])).rows[0];
    expect(userDb.status).toBe('inactive');
    expect(userDb.full_name).toBe('New Inactive Name');
    expect(userDb.email).toBe('keepme@example.com');
  });

  it('7. Missing full_name column returns 400 VALIDATION_ERROR', async () => {
    const csv = 'external_id,email\nSV001,test@example.com';
    const res = await api.call('POST', '/imports/roster', { csv });
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe('VALIDATION_ERROR');
  });
});
