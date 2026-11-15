import { connect, MqttClient } from 'mqtt';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../../src/config';
import { MqttGateway } from '../../src/distribution/mqtt-gateway';
import { OutboxWorker } from '../../src/distribution/outbox-worker';
import { OutgoingMessage } from '../../src/distribution/sync.service';
import { deriveKm, verify } from '../../src/shared/crypto/crypto-v1';
import { loadMasterKey } from '../../src/shared/crypto/uid-vault';
import { ApiContext, startSignedIn } from '../support/api';
import { TEST_DATABASE_URL } from '../support/db';
import { testKeysDir } from '../support/keys';

const BOOT = '9f2c8d14-5b1e-4c33-9a70-0d6f2e8b1c47';
const NONCE = '7f3a9c1e5b2d4f60a8e1c3b5d7f90214';

const report = (schema: 'hello-v1' | 'heartbeat-v1', identity: string, version: number): Buffer =>
  Buffer.from(
    JSON.stringify(
      schema === 'hello-v1'
        ? {
            schema,
            workstation_id: identity,
            boot_id: BOOT,
            agent_version: '1.0.0',
            snapshot_version: version,
            key_version: 1,
            lease_nonce: NONCE,
            pending_outbox_count: 0,
            profiles: ['student'],
            local_time: Date.now() / 1000,
          }
        : {
            schema,
            workstation_id: identity,
            boot_id: BOOT,
            snapshot_version: version,
            lease_nonce: NONCE,
            trust_state: 'Fresh',
            local_time: Date.now() / 1000,
            clock_skew_detected: false,
            last_apply_error: null,
            active_session_id: null,
            profiles: ['student'],
          },
    ),
  );
const addWorkstation = async (api: ApiContext, identity: string, mac: string): Promise<string> =>
  (
    await api.pool.query(
      `INSERT INTO workstations (mqtt_identity, machine_id, mac_address, hostname, public_key) VALUES ($1, $1, $2, $1, 'pk') RETURNING id`,
      [identity, mac],
    )
  ).rows[0].id;
const version = (m: OutgoingMessage): number => JSON.parse(m.payload.toString('utf8')).version;

describe('MQTT settings', () => {
  const base = { DATABASE_URL: 'postgres://u:p@localhost/db', JWT_SECRET: 'x'.repeat(32) };

  it('are off by default and take the broker URL and mTLS files from the environment', () => {
    const keysDir = path.join('some', 'keys');
    expect(loadConfig({ ...base, KEYS_DIR: keysDir })).toMatchObject({
      mqttUrl: '',
      mqttCaFile: path.join(keysDir, 'ca.crt'),
      mqttCertFile: path.join(keysDir, 'nfc-server.crt'),
      mqttKeyFile: path.join(keysDir, 'nfc-server.key'),
    });
    const env = { MQTT_URL: 'mqtts://broker:8883', MQTT_CA: '/pki/ca.crt', MQTT_CERT: '/pki/server.crt', MQTT_KEY: '/pki/server.key' };
    expect(loadConfig({ ...base, ...env })).toMatchObject({
      mqttUrl: 'mqtts://broker:8883',
      mqttCaFile: '/pki/ca.crt',
      mqttCertFile: '/pki/server.crt',
      mqttKeyFile: '/pki/server.key',
    });
    expect(loadConfig({ ...base, CA_CERT_FILE: '/pki/ca.crt' }).mqttCaFile).toBe('/pki/ca.crt');
    expect(() => loadConfig({ ...base, MQTT_URL: 'http://broker' })).toThrow(/MQTT_URL/);
  });
});

(TEST_DATABASE_URL ? describe : describe.skip)('MQTT gateway without a broker', () => {
  let api: ApiContext;
  let gateway: MqttGateway;
  let worker: OutboxWorker;
  let ws: string;
  let sent: OutgoingMessage[];

  beforeAll(async () => {
    api = await startSignedIn(TEST_DATABASE_URL as string);
    gateway = api.ctx.app.get(MqttGateway, { strict: false });
    worker = api.ctx.app.get(OutboxWorker, { strict: false });
    ws = await addWorkstation(api, 'lab-a-01', '02:00:00:00:00:01');
  });
  beforeEach(() => {
    sent = [];
    gateway.send = async (message) => {
      sent.push(message);
      return true;
    };
  });
  afterAll(async () => api.close());

  it('reports mqtt as disabled when no broker is configured, without degrading the health status', async () => {
    expect(gateway.state()).toBe('disabled');
    const health = (await (await api.call('GET', '/system/health')).json()) as { status: string; mqtt: string };
    expect(health).toMatchObject({ status: 'ok', mqtt: 'disabled' });
  });

  it('routes a Hello and a heartbeat to the sync service and sends the replies', async () => {
    const onHello = await gateway.receive('lab/workstation/lab-a-01/hello', report('hello-v1', 'lab-a-01', 0));
    expect(onHello.map((m) => [m.topic, m.retain])).toEqual([['lab/workstation/lab-a-01/snapshot', true]]);
    expect(sent).toEqual(onHello);
    const onHeartbeat = await gateway.receive('lab/workstation/lab-a-01/heartbeat', report('heartbeat-v1', 'lab-a-01', 1));
    expect(onHeartbeat.map((m) => [m.topic, m.retain])).toEqual([['lab/workstation/lab-a-01/lease', false]]);
    expect(sent).toHaveLength(2);
  });

  it('ignores topics it does not handle and payloads that name another workstation', async () => {
    const hello = report('hello-v1', 'lab-a-01', 0);
    for (const topic of ['lab/workstation/lab-a-01/status', 'lab/workstation/x/hello', 'lab/workstation/lab-a-01/hello/extra', 'other/topic']) {
      expect(await gateway.receive(topic, hello)).toEqual([]);
    }
    expect(await gateway.receive('lab/workstation/lab-a-02/hello', hello)).toEqual([]);
    expect(sent).toEqual([]);
  });

  it('publishes a snapshot as soon as the worker issues a new version, and nothing when the content is unchanged', async () => {
    await api.pool.query("UPDATE workstation_profiles SET status = 'disabled' WHERE workstation_id = $1", [ws]);
    const results = await worker.reconcileNow();
    expect(results.map((r) => [r.mqtt_identity, r.version])).toEqual([['lab-a-01', 2]]);
    expect(sent.map((m) => [m.topic, m.retain, version(m)])).toEqual([['lab/workstation/lab-a-01/snapshot', true, 2]]);
    sent = [];
    await worker.reconcileNow();
    expect(sent).toEqual([]);

    // Through the outbox as well: an event leads to one publish.
    await api.pool.query("UPDATE workstation_profiles SET status = 'enabled' WHERE workstation_id = $1", [ws]);
    await api.pool.query(
      `INSERT INTO server_outbox (aggregate_type, aggregate_id, event_type, payload) VALUES ('workstation', $1, 'WorkstationProfileConfigured', '{}')`,
      [ws],
    );
    const run = await worker.runOnce();
    expect(run.events).toBeGreaterThan(0);
    expect(sent.map(version)).toEqual([3]);
  });

  it('applies an outbox batch and sends the ACK; an untrusted batch gets no reply', async () => {
    const batch = (identity: string) =>
      Buffer.from(
        JSON.stringify({
          schema: 'outbox-v1',
          workstation_id: identity,
          batch_id: 'b-1',
          from_seq: 7,
          to_seq: 7,
          records: [
            {
              entry_id: '5b0d3a1e-9c4f-4a2b-8e6d-1f2a3b4c5d6e',
              outbox_seq: 7,
              occurred_at: Date.now() / 1000,
              event_type: 'security_alert',
              payload: { kind: 'edge_db_recovered', detail: { lost_outbox_entries: 1 } },
            },
          ],
        }),
      );
    const replies = await gateway.receive('lab/workstation/lab-a-01/outbox', batch('lab-a-01'));
    expect(replies.map((m) => [m.topic, m.retain])).toEqual([['lab/workstation/lab-a-01/command/ack', false]]);
    expect(JSON.parse(replies[0].payload.toString('utf8'))).toMatchObject({ command: 'ack_outbox', acked_seq: 7 });
    expect(sent).toEqual(replies);
    expect((await api.pool.query('SELECT kind FROM workstation_alerts')).rows).toEqual([{ kind: 'edge_db_recovered' }]);
    expect(await gateway.receive('lab/workstation/lab-a-01/outbox', batch('lab-a-02'))).toEqual([]);
    expect(sent).toHaveLength(1);
  });

  it('survives a send that fails: the reply is dropped and the worker still finishes', async () => {
    gateway.send = async () => {
      throw new Error('broker gone');
    };
    expect(await gateway.receive('lab/workstation/lab-a-01/hello', report('hello-v1', 'lab-a-01', 0))).toEqual([]);
    await api.pool.query("UPDATE workstation_profiles SET status = 'disabled' WHERE workstation_id = $1", [ws]);
    const results = await worker.reconcileNow();
    expect(results.map((r) => r.version)).toEqual([4]);
  });
});

// Needs the dev broker (deploy/dev): TEST_MQTT_URL=mqtts://localhost:8883 TEST_MQTT_CERTS=<deploy/dev/certs>.
const mqttUrl = process.env.TEST_MQTT_URL;
const certs = process.env.TEST_MQTT_CERTS ?? '';
(TEST_DATABASE_URL && mqttUrl && certs ? describe : describe.skip)('MQTT gateway with the dev broker', () => {
  const ENV = ['MQTT_URL', 'MQTT_CA', 'MQTT_CERT', 'MQTT_KEY'] as const;
  const saved = ENV.map((key) => [key, process.env[key]] as const);
  let api: ApiContext;
  let gateway: MqttGateway;
  let agent: MqttClient;
  const received: { topic: string; payload: Buffer; signature: string | undefined }[] = [];

  const until = async (check: () => boolean, what: string): Promise<void> => {
    const deadline = Date.now() + 10_000;
    while (!check()) {
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  };

  beforeAll(async () => {
    process.env.MQTT_URL = mqttUrl;
    process.env.MQTT_CA = path.join(certs, 'ca.crt');
    process.env.MQTT_CERT = path.join(certs, 'nfc-server.crt');
    process.env.MQTT_KEY = path.join(certs, 'nfc-server.key');
    api = await startSignedIn(TEST_DATABASE_URL as string);
    gateway = api.ctx.app.get(MqttGateway, { strict: false });
    await addWorkstation(api, 'ws-dev-01', '02:00:00:00:00:d1');
    await until(() => gateway.state() === 'ok', 'the server to connect');
    // The workstation side: the dev certificate CN=ws-dev-01, as an agent would connect.
    agent = connect(mqttUrl as string, {
      protocolVersion: 5,
      clientId: 'ws-dev-01',
      clean: true,
      reconnectPeriod: 0,
      ca: readFileSync(path.join(certs, 'ca.crt')),
      cert: readFileSync(path.join(certs, 'ws-dev-01.crt')),
      key: readFileSync(path.join(certs, 'ws-dev-01.key')),
    });
    agent.on('message', (topic, payload, packet) => {
      const signature = packet.properties?.userProperties?.signature;
      received.push({ topic, payload, signature: Array.isArray(signature) ? signature[0] : signature });
    });
    await new Promise<void>((resolve, reject) => {
      agent.once('connect', () => resolve());
      agent.once('error', reject);
    });
    await agent.subscribeAsync(['lab/workstation/ws-dev-01/snapshot', 'lab/workstation/ws-dev-01/lease'], { qos: 1 });
    // A retained snapshot of an earlier run may arrive on subscribe; only what follows the Hello counts.
    await new Promise((resolve) => setTimeout(resolve, 300));
    received.length = 0;
  }, 30_000);

  afterAll(async () => {
    if (agent) await agent.endAsync();
    if (api) await api.close();
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('answers a real Hello with a signed retained snapshot and a heartbeat with a signed lease', async () => {
    const km = deriveKm(loadMasterKey(testKeysDir()), 'ws-dev-01', 1);
    const health = (await (await api.call('GET', '/system/health')).json()) as { status: string; mqtt: string };
    expect(health).toMatchObject({ status: 'ok', mqtt: 'ok' });

    await agent.publishAsync('lab/workstation/ws-dev-01/hello', report('hello-v1', 'ws-dev-01', 0), { qos: 1 });
    await until(() => received.some((m) => m.topic.endsWith('/snapshot')), 'the snapshot');
    const snapshot = received.find((m) => m.topic.endsWith('/snapshot')) as (typeof received)[number];
    expect(JSON.parse(snapshot.payload.toString('utf8'))).toMatchObject({ schema: 'snapshot-v1', workstation_id: 'ws-dev-01', version: 1 });
    expect(verify(km, 'snapshot-v1', snapshot.payload, snapshot.signature as string)).toBe(true);

    await agent.publishAsync('lab/workstation/ws-dev-01/heartbeat', report('heartbeat-v1', 'ws-dev-01', 1), { qos: 0 });
    await until(() => received.some((m) => m.topic.endsWith('/lease')), 'the lease');
    const lease = received.find((m) => m.topic.endsWith('/lease')) as (typeof received)[number];
    expect(JSON.parse(lease.payload.toString('utf8'))).toMatchObject({ schema: 'lease-v1', desired_version: 1, nonce: NONCE });
    expect(verify(km, 'lease-v1', lease.payload, lease.signature as string)).toBe(true);
  }, 30_000);
});
