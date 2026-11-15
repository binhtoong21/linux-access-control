import { createHash, X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { EnrollmentService } from '../../src/device/enrollment.service';
import { deriveKm } from '../../src/shared/crypto/crypto-v1';
import { loadMasterKey } from '../../src/shared/crypto/uid-vault';
import { ApiContext, auditActions, errorCode, outboxEvents, startSignedIn } from '../support/api';
import { TEST_DATABASE_URL } from '../support/db';
import { testKeysDir } from '../support/keys';
import { makeCsr } from '../support/pki';

interface Ticket {
  request_id: string;
  fetch_code: string;
  poll_interval_sec: number;
}
interface RequestView {
  id: string;
  hostname: string;
  mac_address: string;
  machine_id: string;
  status: string;
  duplicate_mac_detected: boolean;
  duplicate_of: { id: string; mqtt_identity: string } | null;
  workstation: { id: string; mqtt_identity: string } | null;
}
interface Approved {
  status: string;
  mqtt_identity: string;
  key_version: number;
  client_cert_pem: string;
  k_m: string;
  broker: { host: string; port: number };
}

(TEST_DATABASE_URL ? describe : describe.skip)('workstation enrollment', () => {
  let api: ApiContext;
  let service: EnrollmentService;
  let zone: string;
  let n = 0;
  const missing = '00000000-0000-4000-8000-000000000000';

  // The agent: no session cookie and no X-Requested-With header.
  const agent = (method: string, urlPath: string, body?: unknown, code?: string): Promise<Response> =>
    fetch(`${api.ctx.base}/api/v1${urlPath}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(code ? { Authorization: `Bearer ${code}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const json = async <T>(res: Response, status: number): Promise<T> => {
    expect(res.status).toBe(status);
    return (await res.json()) as T;
  };
  /** A fresh machine: unique machine id and MAC unless overridden. */
  const machine = async (override: Record<string, unknown> = {}) => {
    n += 1;
    const hex = n.toString(16).padStart(2, '0');
    return { machine_id: `machine-${hex}`, hostname: `lab-pc-${hex}`, mac_address: `52:54:00:00:00:${hex}`, csr_pem: await makeCsr(), ...override };
  };
  const enroll = async (override: Record<string, unknown> = {}): Promise<Ticket & { body: Record<string, unknown> }> => {
    const body = await machine(override);
    return { ...(await json<Ticket>(await agent('POST', '/workstations/enroll', body), 201)), body };
  };
  const poll = (t: Ticket): Promise<Response> => agent('GET', `/workstations/enroll/${t.request_id}/status`, undefined, t.fetch_code);
  const pending = async (): Promise<RequestView[]> => json<RequestView[]>(await api.call('GET', '/enrollment-requests'), 200);
  const approve = (id: string, mqttIdentity: string, zoneId: string | null = zone): Promise<Response> =>
    api.call('POST', `/enrollment-requests/${id}/approve`, { mode: 'new', mqtt_identity: mqttIdentity, zone_id: zoneId });

  beforeAll(async () => {
    api = await startSignedIn(TEST_DATABASE_URL as string);
    service = api.ctx.app.get(EnrollmentService, { strict: false });
    zone = (await json<{ id: string }>(await api.call('POST', '/zones', { name: 'Lab A', location: 'B1-201' }), 201)).id;
  });
  beforeEach(() => {
    service.submitLimiter.reset();
    service.statusLimiter.reset();
  });
  afterAll(async () => api.close());

  it('accepts a request without a session and stores only the hash of the fetch code', async () => {
    const ticket = await enroll();
    expect(ticket.request_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(ticket.fetch_code).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(ticket.poll_interval_sec).toBe(5);
    const row = (await api.pool.query('SELECT status, fetch_code_hash, duplicate_mac_detected FROM enrollment_requests WHERE id = $1', [ticket.request_id])).rows[0];
    expect(row).toEqual({ status: 'pending', fetch_code_hash: createHash('sha256').update(ticket.fetch_code).digest('hex'), duplicate_mac_detected: false });
    expect(await json(await poll(ticket), 200)).toEqual({ status: 'pending', poll_interval_sec: 5 });
    const list = await pending();
    expect(list.map((r) => r.id)).toEqual([ticket.request_id]);
    expect(list[0]).toMatchObject({ hostname: ticket.body.hostname, mac_address: ticket.body.mac_address, status: 'pending', duplicate_of: null, workstation: null });
  });

  it('rejects a bad CSR and malformed input', async () => {
    for (const csr of ['not a csr', await makeCsr('rsa'), await makeCsr('p256')]) {
      const res = await agent('POST', '/workstations/enroll', await machine({ csr_pem: csr }));
      expect(res.status).toBe(400);
      expect(await errorCode(res)).toBe('INVALID_CSR');
    }
    for (const bad of [{ mac_address: 'nope' }, { machine_id: 'has space' }, { hostname: '   ' }, { csr_pem: undefined }, { extra: 1 }]) {
      const res = await agent('POST', '/workstations/enroll', await machine(bad));
      expect([JSON.stringify(bad), res.status]).toEqual([JSON.stringify(bad), 400]);
      expect(await errorCode(res)).toBe('VALIDATION_ERROR');
    }
  });

  it('answers 401 INVALID_FETCH_CODE for a wrong, missing or foreign code and an unknown or malformed id', async () => {
    const a = await enroll();
    const b = await enroll();
    const attempts: Promise<Response>[] = [
      agent('GET', `/workstations/enroll/${a.request_id}/status`),
      agent('GET', `/workstations/enroll/${a.request_id}/status`, undefined, 'wrong'),
      agent('GET', `/workstations/enroll/${a.request_id}/status`, undefined, b.fetch_code),
      agent('GET', `/workstations/enroll/${missing}/status`, undefined, a.fetch_code),
      agent('GET', '/workstations/enroll/not-a-uuid/status', undefined, a.fetch_code),
    ];
    for (const attempt of attempts) {
      const res = await attempt;
      expect(res.status).toBe(401);
      expect(await errorCode(res)).toBe('INVALID_FETCH_CODE');
    }
    await api.pool.query('UPDATE enrollment_requests SET fetch_code_invalidated_at = now() WHERE id = $1', [b.request_id]);
    expect((await poll(b)).status).toBe(401);
    for (const t of [a, b]) await json(await api.call('POST', `/enrollment-requests/${t.request_id}/reject`, {}), 200);
  });

  it('approves a request as a new workstation and hands the credentials to the agent', async () => {
    const ticket = await enroll();
    const view = await json<RequestView>(await approve(ticket.request_id, 'lab-a-01'), 200);
    expect(view).toMatchObject({ status: 'approved', duplicate_of: null, workstation: { mqtt_identity: 'lab-a-01' } });
    const wsId = view.workstation?.id as string;
    const ws = (await api.pool.query('SELECT status, key_version, zone_id, hostname, cert_serial, cert_expires_at FROM workstations WHERE id = $1', [wsId])).rows[0];
    expect(ws).toMatchObject({ status: 'enrolled', key_version: 1, zone_id: zone, hostname: ticket.body.hostname });
    expect(await auditActions(api.pool, wsId)).toEqual(['enrollment.approve']);
    expect(await outboxEvents(api.pool, wsId)).toEqual([
      { event_type: 'WorkstationEnrollmentApproved', payload: { request_id: ticket.request_id, mode: 'new', key_version: 1 } },
    ]);

    const creds = await json<Approved>(await poll(ticket), 200);
    expect(creds).toMatchObject({ status: 'approved', mqtt_identity: 'lab-a-01', key_version: 1, broker: { host: 'localhost', port: 8883 } });
    expect(creds.k_m).toBe(deriveKm(loadMasterKey(testKeysDir()), 'lab-a-01', 1).toString('hex'));
    const cert = new X509Certificate(creds.client_cert_pem);
    const ca = new X509Certificate(readFileSync(path.join(testKeysDir(), 'ca.crt')));
    expect(cert.subject).toBe('CN=lab-a-01');
    expect(cert.checkIssued(ca)).toBe(true);
    expect(cert.verify(ca.publicKey)).toBe(true);
    expect(cert.serialNumber.toLowerCase()).toBe(ws.cert_serial);
    expect(new Date(cert.validTo).getTime()).toBe(new Date(ws.cert_expires_at).getTime());
    // Asked again (lost reply): the same credentials.
    expect((await json<Approved>(await poll(ticket), 200)).client_cert_pem).toBe(creds.client_cert_pem);

    // Idempotent approval; other parameters are refused.
    expect((await json<RequestView>(await approve(ticket.request_id, 'lab-a-01'), 200)).workstation?.id).toBe(wsId);
    for (const res of [await approve(ticket.request_id, 'lab-a-02'), await approve(ticket.request_id, 'lab-a-01', null)]) {
      expect(res.status).toBe(409);
      expect(await errorCode(res)).toBe('INVALID_STATE_TRANSITION');
    }
    expect((await api.pool.query('SELECT count(*)::int AS n FROM workstations')).rows[0].n).toBe(1);
    const listed = await json<{ mqtt_identity: string }[]>(await api.call('GET', '/workstations'), 200);
    expect(listed.map((w) => w.mqtt_identity)).toEqual(['lab-a-01']);
    expect((await json<RequestView[]>(await api.call('GET', '/enrollment-requests?status=approved'), 200)).map((r) => r.id)).toEqual([ticket.request_id]);
  });

  it('refuses a taken name, a malformed name, an unknown zone and an unknown request', async () => {
    const ticket = await enroll();
    const taken = await approve(ticket.request_id, 'lab-a-01');
    expect(taken.status).toBe(409);
    expect(await errorCode(taken)).toBe('DUPLICATE');
    expect((await approve(ticket.request_id, 'x')).status).toBe(400);
    expect((await approve(ticket.request_id, 'lab-a-02', missing)).status).toBe(400);
    expect((await api.call('POST', `/enrollment-requests/${ticket.request_id}/approve`, { mode: 'reinstall' })).status).toBe(409);
    expect((await approve(missing, 'lab-a-02')).status).toBe(404);
    // Outside any zone is allowed.
    const view = await json<RequestView>(await approve(ticket.request_id, 'lab-a-02', null), 200);
    const ws = (await api.pool.query('SELECT zone_id FROM workstations WHERE id = $1', [view.workstation?.id])).rows[0];
    expect(ws.zone_id).toBeNull();
  });

  it('flags a request that collides with an existing workstation and refuses to approve it as new (INV-009)', async () => {
    const first = (await pending()).length;
    const existing = (await api.pool.query("SELECT id, mac_address::text AS mac, machine_id FROM workstations WHERE mqtt_identity = 'lab-a-01'")).rows[0];
    const sameMac = await enroll({ mac_address: existing.mac });
    const sameMachine = await enroll({ machine_id: existing.machine_id });
    const list = await pending();
    expect(list).toHaveLength(first + 2);
    for (const t of [sameMac, sameMachine]) {
      const view = list.find((r) => r.id === t.request_id);
      expect(view).toMatchObject({ duplicate_mac_detected: true, duplicate_of: { id: existing.id, mqtt_identity: 'lab-a-01' } });
      const res = await approve(t.request_id, `lab-a-1${t === sameMac ? 0 : 1}`);
      expect(res.status).toBe(409);
      expect(await errorCode(res)).toBe('DUPLICATE_REQUIRES_REINSTALL');
      await json(await api.call('POST', `/enrollment-requests/${t.request_id}/reject`, { note: 'trùng máy' }), 200);
    }
    expect((await api.pool.query('SELECT count(*)::int AS n FROM workstations')).rows[0].n).toBe(2);
  });

  it('flags two pending requests of one machine, and the loser becomes a duplicate of the approved workstation', async () => {
    const a = await enroll();
    const b = await enroll({ machine_id: a.body.machine_id });
    let list = await pending();
    for (const t of [a, b]) expect(list.find((r) => r.id === t.request_id)).toMatchObject({ duplicate_mac_detected: true, duplicate_of: null });
    const view = await json<RequestView>(await approve(a.request_id, 'lab-a-03'), 200);
    list = await pending();
    expect(list.find((r) => r.id === b.request_id)?.duplicate_of).toEqual({ id: view.workstation?.id, mqtt_identity: 'lab-a-03' });
    const res = await approve(b.request_id, 'lab-a-04');
    expect(await errorCode(res)).toBe('DUPLICATE_REQUIRES_REINSTALL');
    await json(await api.call('POST', `/enrollment-requests/${b.request_id}/reject`, {}), 200);
  });

  it('replaces the older pending request when the same machine retries with the same key', async () => {
    const first = await enroll();
    const retry = await enroll({ ...first.body });
    expect(retry.request_id).not.toBe(first.request_id);
    expect(await json(await poll(first), 200)).toEqual({ status: 'rejected' });
    const view = (await pending()).find((r) => r.id === retry.request_id);
    expect(view).toMatchObject({ duplicate_mac_detected: false, duplicate_of: null });
    await json(await api.call('POST', `/enrollment-requests/${retry.request_id}/reject`, {}), 200);
  });

  it('rejects a pending request once; an approved one cannot be rejected and a rejected one cannot be approved', async () => {
    const ticket = await enroll();
    const rejected = await json<RequestView>(await api.call('POST', `/enrollment-requests/${ticket.request_id}/reject`, { note: 'máy lạ' }), 200);
    expect(rejected.status).toBe('rejected');
    await json(await api.call('POST', `/enrollment-requests/${ticket.request_id}/reject`, {}), 200);
    expect(await auditActions(api.pool, ticket.request_id)).toEqual(['enrollment.reject']);
    expect(await json(await poll(ticket), 200)).toEqual({ status: 'rejected' });
    const late = await approve(ticket.request_id, 'lab-a-09');
    expect(late.status).toBe(409);
    expect(await errorCode(late)).toBe('INVALID_STATE_TRANSITION');
    const approved = (await json<RequestView[]>(await api.call('GET', '/enrollment-requests?status=approved'), 200))[0];
    const res = await api.call('POST', `/enrollment-requests/${approved.id}/reject`, {});
    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe('INVALID_STATE_TRANSITION');
    expect((await api.call('POST', `/enrollment-requests/${missing}/reject`, {})).status).toBe(404);
  });

  it('requires an admin session for the admin endpoints', async () => {
    expect((await agent('GET', '/enrollment-requests')).status).toBe(401);
    expect((await agent('POST', `/enrollment-requests/${missing}/reject`, {})).status).toBe(403);
  });

  it('limits submissions per IP and status calls per request', async () => {
    const tickets: Ticket[] = [];
    for (let i = 0; i < 10; i += 1) tickets.push(await enroll());
    const blocked = await agent('POST', '/workstations/enroll', await machine());
    expect(blocked.status).toBe(429);
    expect(await errorCode(blocked)).toBe('RATE_LIMITED');
    for (let i = 0; i < 30; i += 1) expect((await poll(tickets[0])).status).toBe(200);
    expect((await poll(tickets[0])).status).toBe(429);
    expect((await poll(tickets[1])).status).toBe(200);
  });
});
