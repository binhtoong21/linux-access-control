import { Inject, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { connect, MqttClient } from 'mqtt';
import { readFileSync } from 'node:fs';
import { APP_CONFIG, AppConfig } from '../config';
import { OutboxWorker } from './outbox-worker';
import { ReconcileResult } from './snapshot.service';
import { OutgoingMessage, SyncService } from './sync.service';

/** Topics the server reads (ADR-002 §1); outbox and status are added with the ingest of audit records. */
export const SUBSCRIPTIONS = ['lab/workstation/+/hello', 'lab/workstation/+/heartbeat'];
const TOPIC = /^lab\/workstation\/([A-Za-z0-9_-]{3,64})\/(hello|heartbeat)$/;
const OFFLINE_CHECK_MS = 30_000;
const RECONNECT_MS = 2_000;

export type MqttState = 'ok' | 'down' | 'disabled';
type MqttConfig = Pick<AppConfig, 'mqttUrl' | 'mqttCaFile' | 'mqttCertFile' | 'mqttKeyFile'>;

/**
 * The only place that talks to the broker. It carries bytes: what a message means is decided by SyncService, and
 * every message to a workstation is already signed with that workstation's K_m before it gets here (ADR-003 §4).
 */
@Injectable()
export class MqttGateway implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('Mqtt');
  private client: MqttClient | undefined;
  private timer: NodeJS.Timeout | undefined;
  /** Sends one message; false when it could not be sent. Replaced in tests. */
  send: (message: OutgoingMessage) => Promise<boolean> = (message) => this.publish(message);

  constructor(
    private readonly sync: SyncService,
    private readonly worker: OutboxWorker,
    @Inject(APP_CONFIG) private readonly config: MqttConfig,
  ) {}

  onApplicationBootstrap(): void {
    // A new snapshot version goes out as soon as it is stored (schedule-sync.md); Hello repairs anything missed.
    this.worker.onIssued = (issued) => this.publishSnapshots(issued);
    if (!this.config.mqttUrl) return;
    const client = connect(this.config.mqttUrl, {
      protocolVersion: 5,
      clientId: `nfc-server-${process.pid}`,
      clean: true,
      reconnectPeriod: RECONNECT_MS,
      connectTimeout: 10_000,
      rejectUnauthorized: true,
      ca: readFileSync(this.config.mqttCaFile),
      cert: readFileSync(this.config.mqttCertFile),
      key: readFileSync(this.config.mqttKeyFile),
    });
    this.client = client;
    client.on('connect', () => {
      this.logger.log(`connected to ${this.config.mqttUrl}`);
      client.subscribe(SUBSCRIPTIONS, { qos: 1 }, (err) => {
        if (err) this.logger.error(`subscribe failed: ${err.message}`);
      });
    });
    client.on('message', (topic, payload) => void this.receive(topic, payload));
    client.on('error', (err) => this.logger.error(`broker error: ${err.message}`));
    this.timer = setInterval(() => void this.checkOffline(), OFFLINE_CHECK_MS);
    this.timer.unref();
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.worker.onIssued = undefined;
    const client = this.client;
    this.client = undefined;
    if (client) await client.endAsync();
  }

  state(): MqttState {
    if (!this.config.mqttUrl) return 'disabled';
    return this.client?.connected ? 'ok' : 'down';
  }

  /** Handles one received message and sends the replies. Never throws: one bad message must not stop the others. */
  async receive(topic: string, payload: Buffer): Promise<OutgoingMessage[]> {
    const match = TOPIC.exec(topic);
    if (!match) return [];
    const [, identity, kind] = match;
    try {
      const replies = kind === 'hello' ? await this.sync.handleHello(identity, payload) : await this.sync.handleHeartbeat(identity, payload);
      for (const reply of replies) await this.send(reply);
      return replies;
    } catch (err) {
      this.logger.error(`${kind} of ${identity} failed: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
  }

  /** Publishes the newest snapshot of each workstation that just got a new version. */
  async publishSnapshots(issued: ReconcileResult[]): Promise<void> {
    for (const result of issued) {
      if (result.version === null) continue;
      const message = await this.sync.snapshotMessage(result.workstation_id);
      if (message) await this.send(message);
    }
  }

  private async checkOffline(): Promise<void> {
    try {
      const offline = await this.sync.markOffline();
      if (offline.length > 0) this.logger.log(`offline: ${offline.join(', ')}`);
    } catch (err) {
      this.logger.error(`offline check failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private publish(message: OutgoingMessage): Promise<boolean> {
    const client = this.client;
    // Not queued while disconnected: the retained snapshot is sent again on the next Hello, a lease is only good at once.
    if (!client || !client.connected) return Promise.resolve(false);
    return new Promise((resolve) => {
      client.publish(
        message.topic,
        message.payload,
        { qos: 1, retain: message.retain, properties: { userProperties: { signature: message.signature } } },
        (err) => {
          if (err) this.logger.error(`publish to ${message.topic} failed: ${err.message}`);
          resolve(!err);
        },
      );
    });
  }
}
