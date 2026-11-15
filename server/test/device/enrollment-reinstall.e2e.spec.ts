import * as x509 from '@peculiar/x509';
import { X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { EnrollmentService } from '../../src/device/enrollment.service';
import { OutboxWorker } from '../../src/distribution/outbox-worker';
import { deriveKm } from '../../src/shared/crypto/crypto-v1';
import { loadMasterKey } from '../../src/shared/crypto/uid-vault';
import { ApiContext, auditActions, errorCode, outboxEvents, startSignedIn } from '../support/api';
import { TEST_DATABASE_URL } from '../support/db';
import { testKeysDir } from '../support/keys';
import { makeCsr } from '../support/pki';

interface Ticket {
  request_id: string;
  fetch_code: string;
  body: { machine_id: string; hostname: string; mac_address: string; csr_pem: string };
}
interface RequestView {
  id: string;
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
}
interface Batch {
  approved: { id: string; mqtt_identity: string; workstation_id: string }[];
  skipped: { id: string; reason: string }[];
}

(TEST_DATABASE_URL ? describe : describe.skip)('enrollment: reinstall, batch approval and disabling', () => {
  let api: ApiContext;
  let service: EnrollmentService;
  let labA: string;
  let labB: string;
  let ws: string;
  let first: Ticket;
  let n = 0;
  const missing = '00000000-0000-4000-8000-000000000000';

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
  /** A machine with a fresh key; machine id and MAC are fresh too unless overridden. */
  const enroll = async (override: Partial<Ticket['body']> = {}): Promise<Ticket> => {
    n += 1;
    const hex = n.toString(16).padStart(2, '0');
    const body = { machine_id: `machine-${hex}`, hostname: `lab-pc-${hex}`, mac_address: `52:54:00:00:00:${hex}`, csr_pem: await makeCsr(), ...override };
    const ticket = await json<{ request_id: string; fetch_code: string }>(await agent('POST', '/workstations/enroll', body), 201);
    return { ...ticket, body };
  };
  const poll = (t: Ticket): Promise<Response> => agent('GET', `/workstations/enroll/${t.request_id}/status`, undefined, t.fetch_code);
  const approve = (id: string, body: unknown): Promise<Response> => api.call('POST', `/enrollment-requests/${id}/approve`, body);
  const asNew = (id: string, name: string, zoneId: string | null = labA) => approve(id, { mode: 'new', mqtt_identity: name, zone_id: zoneId });
  const reinstall = (id: string) => approve(id, { mode: 'reinstall' });
  const reject = async (id: string): Promise<void> => {
    await json(await api.call('POST', `/enrollment-requests/${id}/reject`, {}), 200);
  };
  const row = async (id: string) =>
    (await api.pool.query('SELECT status, key_version, cert_serial, hostname, public_key, zone_id FROM workstations WHERE id = $1', [id])).rows[0];
  const revoked = async (): Promise<{ cert_serial: string; reason: string }[]> =>
    (await api.pool.query('SELECT cert_serial, reason FROM revoked_certificates ORDER BY revoked_at, cert_serial')).rows;
  const crlSerials = (): string[] =>
    new x509.X509Crl(readFileSync(path.join(testKeysDir(), 'crl.pem'), 'utf8')).entries.map((e) => e.serialNumber.toLowerCase());
  /** The same physical machine asking again with a new key (`nfc-agent reenroll`). */
  const reenroll = (): Promise<Ticket> => enroll({ machine_id: first.body.machine_id, mac_address: first.body.mac_address });

  beforeAll(async () => {
    api = await startSignedIn(TEST_DATABASE_URL as string);
    service = api.ctx.app.get(EnrollmentService, { strict: false });
    labA = (await json<{ id: string }>(await api.call('POST', '/zones', { name: 'Lab A', location: 'B1-201' }), 201)).id;
    labB = (await json<{ id: string }>(await api.call('POST', '/zones', { name: 'Lab B', location: 'B1-202' }), 201)).id;
    first = await enroll();
    ws = (await json<RequestView>(await asNew(first.request_id, 'lab-a-01'), 200)).workstation?.id as string;
  });
  beforeEach(() => {
    service.submitLimiter.reset();
    service.statusLimiter.reset();
  });
  afterAll(async () => api.close());

  it('reinstalls the workstation in place: new key version and certificate, old certificate revoked', async () => {
    const before = await row(ws);
    const again = await reenroll();
    const view = await json<RequestView>(await reinstall(again.request_id), 200);
    expect(view).toMatchObject({ status: 'approved', duplicate_of: { id: ws, mqtt_identity: 'lab-a-01' }, workstation: { id: ws, mqtt_identity: 'lab-a-01' } });

    const after = await row(ws);
    expect(after).toMatchObject({ status: 'enrolled', key_version: 2, hostname: again.body.hostname, zone_id: labA });
    expect(after.cert_serial).not.toBe(before.cert_serial);
    expect(after.public_key).not.toBe(before.public_key);
    expect(await revoked()).toEqual([{ cert_serial: before.cert_serial, reason: 'reinstalled' }]);
    expect(crlSerials()).toEqual([before.cert_serial]);

    const creds = await json<Approved>(await poll(again), 200);
    expect(creds).toMatchObject({ status: 'approved', mqtt_identity: 'lab-a-01', key_version: 2 });
    expect(creds.k_m).toBe(deriveKm(loadMasterKey(testKeysDir()), 'lab-a-01', 2).toString('hex'));
    const cert = new X509Certificate(creds.client_cert_pem);
    expect(cert.subject).toBe('CN=lab-a-01');
    expect(cert.serialNumber.toLowerCase()).toBe(after.cert_serial);
    // The first enrollment can no longer be fetched: it would now carry the new K_m.
    const stale = await poll(first);
    expect(stale.status).toBe(401);
    expect(await errorCode(stale)).toBe('INVALID_FETCH_CODE');

    expect(await outboxEvents(api.pool, ws)).toEqual([
      { event_type: 'WorkstationEnrollmentApproved', payload: { request_id: first.request_id, mode: 'new', key_version: 1 } },
      { event_type: 'WorkstationEnrollmentApproved', payload: { request_id: again.request_id, mode: 'reinstall', key_version: 2 } },
    ]);
    expect(await auditActions(api.pool, ws)).toEqual(['enrollment.approve', 'enrollment.approve']);

    // Idempotent; the same request can no longer become a new workstation.
    await json<RequestView>(await reinstall(again.request_id), 200);
    expect((await row(ws)).key_version).toBe(2);
    expect(await revoked()).toHaveLength(1);
    const other = await asNew(again.request_id, 'lab-a-77');
    expect(other.status).toBe(409);
    expect(await errorCode(other)).toBe('INVALID_STATE_TRANSITION');

    // The next snapshot is built for the new key version.
    await api.ctx.app.get(OutboxWorker, { strict: false }).runOnce();
    const snapshot = (await api.pool.query('SELECT key_version FROM snapshots WHERE workstation_id = $1 ORDER BY version DESC LIMIT 1', [ws])).rows[0];
    expect(snapshot.key_version).toBe(2);
  });

  it('refuses a reinstall for a request that matches no workstation, a rejected or an unknown request', async () => {
    const fresh = await enroll();
    for (const res of [await reinstall(fresh.request_id)]) {
      expect(res.status).toBe(409);
      expect(await errorCode(res)).toBe('INVALID_STATE_TRANSITION');
    }
    expect((await approve(fresh.request_id, { mode: 'new' })).status).toBe(400);
    expect((await approve(fresh.request_id, { mode: 'other', mqtt_identity: 'lab-a-50' })).status).toBe(400);
    await reject(fresh.request_id);
    const dup = await reenroll();
    await reject(dup.request_id);
    const late = await reinstall(dup.request_id);
    expect(late.status).toBe(409);
    expect(await errorCode(late)).toBe('INVALID_STATE_TRANSITION');
    expect((await reinstall(missing)).status).toBe(404);
    expect((await row(ws)).key_version).toBe(2);
  });

  it('disables a workstation: certificate revoked, CRL rewritten, repeatable, and only re-enrollment brings it back', async () => {
    const before = await row(ws);
    for (const bad of [{}, { confirm: false }, { confirm: 'yes' }]) {
      expect((await api.call('POST', `/workstations/${ws}/disable`, bad)).status).toBe(400);
    }
    expect((await api.call('POST', `/workstations/${missing}/disable`, { confirm: true })).status).toBe(404);

    const detail = await json<{ status: string; mqtt_identity: string }>(await api.call('POST', `/workstations/${ws}/disable`, { confirm: true }), 200);
    expect(detail).toMatchObject({ status: 'disabled', mqtt_identity: 'lab-a-01' });
    await json(await api.call('POST', `/workstations/${ws}/disable`, { confirm: true }), 200);
    expect((await auditActions(api.pool, ws)).filter((a) => a === 'workstation.disable')).toHaveLength(1);
    const list = await revoked();
    expect(list).toHaveLength(2);
    expect(list[1]).toEqual({ cert_serial: before.cert_serial, reason: 'disabled' });
    expect(crlSerials().sort()).toEqual(list.map((r) => r.cert_serial).sort());
    const disabled = await json<{ mqtt_identity: string }[]>(await api.call('GET', '/workstations?status=disabled'), 200);
    expect(disabled.map((w) => w.mqtt_identity)).toEqual(['lab-a-01']);

    const again = await reenroll();
    await json<RequestView>(await reinstall(again.request_id), 200);
    const after = await row(ws);
    expect(after).toMatchObject({ status: 'enrolled', key_version: 3 });
    expect(after.cert_serial).not.toBe(before.cert_serial);
    // The certificate revoked by the disable stays revoked once; nothing is un-revoked.
    expect(await revoked()).toHaveLength(2);
  });

  it('approves a batch into a zone with sequential names and skips flagged, reviewed and unknown requests', async () => {
    const a = await enroll();
    const b = await enroll();
    const collides = await reenroll();
    const rejected = await enroll();
    await reject(rejected.request_id);
    const batch = await json<Batch>(
      await api.call('POST', '/enrollment-requests/approve-batch', {
        zone_id: labB,
        request_ids: [a.request_id, collides.request_id, b.request_id, rejected.request_id, missing, a.request_id],
        name_prefix: 'lab-b-',
      }),
      200,
    );
    expect(batch.approved.map((x) => [x.id, x.mqtt_identity])).toEqual([
      [a.request_id, 'lab-b-01'],
      [b.request_id, 'lab-b-02'],
    ]);
    expect(batch.skipped).toEqual([
      { id: collides.request_id, reason: 'duplicate' },
      { id: rejected.request_id, reason: 'not_pending' },
      { id: missing, reason: 'not_found' },
    ]);
    const inLabB = await json<{ id: string; mqtt_identity: string }[]>(await api.call('GET', `/workstations?zone_id=${labB}`), 200);
    expect(inLabB.map((w) => w.mqtt_identity)).toEqual(['lab-b-01', 'lab-b-02']);
    expect(inLabB.map((w) => w.id)).toEqual(batch.approved.map((x) => x.workstation_id));
    expect((await json<Approved>(await poll(a), 200)).mqtt_identity).toBe('lab-b-01');

    // Numbering continues after the highest name with the prefix; an approved request is skipped the second time.
    const c = await enroll();
    const d = await enroll();
    const more = await json<Batch>(
      await api.call('POST', '/enrollment-requests/approve-batch', { zone_id: labB, request_ids: [a.request_id, c.request_id], name_prefix: 'lab-b-' }),
      200,
    );
    expect(more).toMatchObject({ approved: [{ id: c.request_id, mqtt_identity: 'lab-b-03' }], skipped: [{ id: a.request_id, reason: 'not_pending' }] });
    const inLabA = await json<Batch>(
      await api.call('POST', '/enrollment-requests/approve-batch', { zone_id: labA, request_ids: [d.request_id], name_prefix: 'lab-a-' }),
      200,
    );
    expect(inLabA.approved.map((x) => x.mqtt_identity)).toEqual(['lab-a-02']);
    await reject(collides.request_id);
  });

  it('validates the batch request', async () => {
    const t = await enroll();
    const bodies = [
      { zone_id: missing, request_ids: [t.request_id], name_prefix: 'lab-c-' },
      { zone_id: labB, request_ids: [], name_prefix: 'lab-c-' },
      { zone_id: labB, request_ids: ['nope'], name_prefix: 'lab-c-' },
      { zone_id: labB, request_ids: [t.request_id], name_prefix: 'bad prefix' },
      { zone_id: labB, request_ids: [t.request_id] },
    ];
    for (const body of bodies) {
      const res = await api.call('POST', '/enrollment-requests/approve-batch', body);
      expect([JSON.stringify(body), res.status]).toEqual([JSON.stringify(body), 400]);
      expect(await errorCode(res)).toBe('VALIDATION_ERROR');
    }
    await reject(t.request_id);
  });
});
