import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'kysely';
import { Db, KYSELY } from '../infra/database/database.module';
import { MASTER_KEY } from '../infra/keys.module';
import { validateMessage } from '../shared/contracts';
import { deriveKm, sign } from '../shared/crypto/crypto-v1';
import { emitEvent } from '../shared/outbox';
import { SNAPSHOT_PARAMETERS } from './snapshot-content';
import { SnapshotService } from './snapshot.service';

/** "Bảng Tham Số": three missed 30s heartbeats. */
export const OFFLINE_AFTER_SEC = 90;
/** D-018 / XINV-007: beyond this the clocks are reported as skewed; it never blocks anything. */
export const CLOCK_SKEW_SEC = 60;
/** A workstation that stays behind is sent the snapshot again at most this often on heartbeats. */
export const RESEND_SNAPSHOT_MS = 60_000;

/** Something to publish with QoS 1; `signature` goes into the MQTT 5 user property of that name. */
export interface OutgoingMessage {
  topic: string;
  payload: Buffer;
  signature: string;
  retain: boolean;
}

interface Report {
  workstation_id: string;
  boot_id: string;
  snapshot_version: number;
  lease_nonce: string;
  profiles: string[];
  local_time: number;
  // hello-v1 only
  key_version?: number;
  // heartbeat-v1 only
  trust_state?: string;
  clock_skew_detected?: boolean;
  last_apply_error?: string | null;
}

type Kind = 'hello' | 'heartbeat';

const topic = (identity: string, leaf: string): string => `lab/workstation/${identity}/${leaf}`;

/**
 * Server side of reconnect.md: a workstation reports its state, the server answers with what it needs to accept cards
 * again, a lease when it is up to date, otherwise the snapshot. No MQTT here: bytes in, messages out.
 */
@Injectable()
export class SyncService {
  private readonly logger = new Logger('Sync');
  private readonly resentAt = new Map<string, number>();
  /** Milliseconds clock; replaced in tests. */
  nowMs: () => number = Date.now;

  constructor(
    @Inject(KYSELY) private readonly db: Db,
    private readonly snapshots: SnapshotService,
    @Inject(MASTER_KEY) private readonly masterKey: Buffer,
  ) {}

  handleHello(identity: string, raw: Buffer): Promise<OutgoingMessage[]> {
    return this.handle('hello', identity, raw);
  }

  handleHeartbeat(identity: string, raw: Buffer): Promise<OutgoingMessage[]> {
    return this.handle('heartbeat', identity, raw);
  }

  /** The newest stored snapshot of a workstation as a retained message, or null when it has none. */
  async snapshotMessage(workstationId: string): Promise<OutgoingMessage | null> {
    const row = (
      await sql<{ mqtt_identity: string; payload_raw: Buffer; hmac_signature: string }>`
        SELECT w.mqtt_identity, s.payload_raw, s.hmac_signature::text AS hmac_signature
        FROM snapshots s JOIN workstations w ON w.id = s.workstation_id
        WHERE s.workstation_id = ${workstationId}::uuid
        ORDER BY s.version DESC LIMIT 1
      `.execute(this.db)
    ).rows[0];
    return row ? { topic: topic(row.mqtt_identity, 'snapshot'), payload: row.payload_raw, signature: row.hmac_signature, retain: true } : null;
  }

  /** BR-019: the heartbeat is the source of truth for online/offline. Returns the identities that just went offline. */
  async markOffline(): Promise<string[]> {
    const rows = (
      await sql<{ mqtt_identity: string }>`
        UPDATE workstation_statuses st SET connectivity = 'offline', updated_at = now()
        FROM workstations w
        WHERE w.id = st.workstation_id AND st.connectivity = 'online'
          AND st.last_heartbeat_at < now() - ${OFFLINE_AFTER_SEC}::int * interval '1 second'
        RETURNING w.mqtt_identity
      `.execute(this.db)
    ).rows;
    return rows.map((r) => r.mqtt_identity).sort();
  }

  private async handle(kind: Kind, identity: string, raw: Buffer): Promise<OutgoingMessage[]> {
    let report: Report;
    try {
      report = JSON.parse(raw.toString('utf8')) as Report;
    } catch {
      this.logger.warn(`${kind} of ${identity} ignored: not JSON`);
      return [];
    }
    const problem = validateMessage(`${kind}-v1`, report);
    if (problem !== null) {
      this.logger.warn(`${kind} of ${identity} ignored: ${problem}`);
      return [];
    }
    // The broker ACL already ties the topic to the certificate's CN; a payload naming another workstation is a bug or a forgery.
    if (report.workstation_id !== identity) {
      this.logger.warn(`${kind} of ${identity} ignored: payload names ${report.workstation_id}`);
      return [];
    }
    const workstation = await this.record(kind, identity, report);
    if (!workstation) return [];
    return this.reply(kind, identity, workstation, report);
  }

  /** Stores what the workstation reported. Null when the workstation is unknown or disabled. */
  private async record(kind: Kind, identity: string, report: Report): Promise<{ id: string; keyVersion: number } | null> {
    return this.db.transaction().execute(async (trx) => {
      const workstation = (
        await sql<{ id: string; key_version: number; status: string }>`
          SELECT id, key_version, status FROM workstations WHERE mqtt_identity = ${identity} FOR UPDATE
        `.execute(trx)
      ).rows[0];
      if (!workstation || workstation.status !== 'enrolled') {
        this.logger.warn(`${kind} of ${identity} ignored: workstation is ${workstation ? workstation.status : 'unknown'}`);
        return null;
      }
      const id = workstation.id;
      const previous = (
        await sql<{
          boot_id: string | null;
          trust_state: string | null;
          last_apply_error: string | null;
          reconcile_state: string;
          draining_started_at: Date | null;
        }>`
          SELECT boot_id, trust_state, last_apply_error, reconcile_state, draining_started_at
          FROM workstation_statuses WHERE workstation_id = ${id}::uuid
        `.execute(trx)
      ).rows[0];
      const now = new Date(this.nowMs());
      // XINV-008: a new boot means sessions of the old boot may have ended unreported; wait for its outbox before inferring.
      const rebooted = previous !== undefined && previous.boot_id !== null && previous.boot_id !== report.boot_id;
      const heartbeat = kind === 'heartbeat';
      const skew = heartbeat ? report.clock_skew_detected === true : Math.abs(report.local_time - now.getTime() / 1000) > CLOCK_SKEW_SEC;
      const trustState = heartbeat ? (report.trust_state ?? null) : (previous?.trust_state ?? null);
      const applyError = heartbeat ? (report.last_apply_error ?? null) : (previous?.last_apply_error ?? null);
      const reconcileState = rebooted ? 'Draining' : (previous?.reconcile_state ?? 'Idle');
      const drainingStartedAt = rebooted ? now : (previous?.draining_started_at ?? null);
      await sql`
        INSERT INTO workstation_statuses
          (workstation_id, connectivity, last_heartbeat_at, boot_id, trust_state, clock_skew_detected, last_apply_error,
           reconcile_state, draining_started_at, updated_at)
        VALUES (${id}::uuid, 'online', ${now}, ${report.boot_id}, ${trustState}, ${skew}, ${applyError}, ${reconcileState},
                ${drainingStartedAt}, ${now})
        ON CONFLICT (workstation_id) DO UPDATE SET
          connectivity = 'online', last_heartbeat_at = EXCLUDED.last_heartbeat_at, boot_id = EXCLUDED.boot_id,
          trust_state = EXCLUDED.trust_state, clock_skew_detected = EXCLUDED.clock_skew_detected,
          last_apply_error = EXCLUDED.last_apply_error, reconcile_state = EXCLUDED.reconcile_state,
          draining_started_at = EXCLUDED.draining_started_at, updated_at = EXCLUDED.updated_at
      `.execute(trx);
      // The reported version is stored as it is, also when it went down (edge.db rebuilt): the reply is decided from it.
      await sql`
        INSERT INTO sync_states (workstation_id, acked_version, acked_at)
        VALUES (${id}::uuid, ${report.snapshot_version}, ${now})
        ON CONFLICT (workstation_id) DO UPDATE SET
          acked_at = CASE WHEN sync_states.acked_version <> EXCLUDED.acked_version THEN EXCLUDED.acked_at ELSE sync_states.acked_at END,
          acked_version = EXCLUDED.acked_version
      `.execute(trx);

      // Auto-Discovery (D-009): accounts the agent found become profiles; flags of known profiles stay the admin's.
      const known = (
        await sql<{ os_username: string; is_default: boolean }>`
          SELECT os_username, is_default FROM workstation_profiles WHERE workstation_id = ${id}::uuid
        `.execute(trx)
      ).rows;
      const names = new Set(known.map((p) => p.os_username));
      const added = [...new Set(report.profiles)].filter((name) => !names.has(name));
      let needsDefault = !known.some((p) => p.is_default);
      for (const name of added) {
        await sql`
          INSERT INTO workstation_profiles (workstation_id, os_username, display_name, is_default)
          VALUES (${id}::uuid, ${name}, ${name}, ${needsDefault})
        `.execute(trx);
        needsDefault = false;
      }
      if (added.length > 0) {
        await emitEvent(trx, { aggregateType: 'workstation', aggregateId: id, eventType: 'WorkstationProfilesDiscovered', payload: { added } });
      }

      if (kind === 'hello') {
        // D-014.4: the first Hello proves the workstation holds its new credentials; they cannot be fetched again.
        await sql`
          UPDATE enrollment_requests SET fetch_code_invalidated_at = ${now}
          WHERE workstation_id = ${id}::uuid AND status = 'approved' AND fetch_code_invalidated_at IS NULL
        `.execute(trx);
        if (report.key_version !== workstation.key_version) {
          this.logger.warn(`${identity} reports key_version ${report.key_version}, server has ${workstation.key_version}`);
        }
      }
      return { id, keyVersion: workstation.key_version };
    });
  }

  private async reply(kind: Kind, identity: string, workstation: { id: string; keyVersion: number }, report: Report): Promise<OutgoingMessage[]> {
    const desired = await this.desiredVersion(workstation.id);
    if (desired >= 1 && report.snapshot_version === desired) {
      return [this.lease(identity, workstation.keyVersion, desired, report.lease_nonce)];
    }
    if (kind === 'heartbeat') {
      const last = this.resentAt.get(identity);
      if (last !== undefined && this.nowMs() - last < RESEND_SNAPSHOT_MS) return [];
    }
    // Issues the first version, a version for changed content, or one above what the workstation holds (D-016).
    await this.snapshots.reconcile(workstation.id);
    const message = await this.snapshotMessage(workstation.id);
    if (!message) return [];
    this.resentAt.set(identity, this.nowMs());
    return [message];
  }

  private async desiredVersion(workstationId: string): Promise<number> {
    const row = (
      await sql<{ desired: number }>`
        SELECT desired_version::int AS desired FROM sync_states WHERE workstation_id = ${workstationId}::uuid
      `.execute(this.db)
    ).rows[0];
    return row?.desired ?? 0;
  }

  /** events.md §4.2: renews the trust period for exactly this version and this nonce (D-018). */
  private lease(identity: string, keyVersion: number, desiredVersion: number, nonce: string): OutgoingMessage {
    const payload = Buffer.from(
      JSON.stringify({
        schema: 'lease-v1',
        workstation_id: identity,
        desired_version: desiredVersion,
        server_time: this.nowMs() / 1000,
        lease_duration_sec: SNAPSHOT_PARAMETERS.lease_duration_sec,
        nonce,
      }),
      'utf8',
    );
    const km = deriveKm(this.masterKey, identity, keyVersion);
    return { topic: topic(identity, 'lease'), payload, signature: sign(km, 'lease-v1', payload), retain: false };
  }
}
