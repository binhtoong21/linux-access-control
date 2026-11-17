import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'kysely';
import { OutgoingMessage } from '../distribution/sync.service';
import { Db, KYSELY } from '../infra/database/database.module';
import { MASTER_KEY } from '../infra/keys.module';
import { deriveKm, normalizeUid, sign, verify } from '../shared/crypto/crypto-v1';
import { UidVault } from '../shared/crypto/uid-vault';

export interface IngestResult {
  /** The signed ACK to publish; null when the batch could not be trusted at all. */
  ack: OutgoingMessage | null;
  applied: number;
  duplicates: number;
  rejected: number;
}

interface WorkstationRow {
  id: string;
  mqtt_identity: string;
  key_version: number;
  hostname: string;
  zone_id: string | null;
  zone_name: string | null;
}

type Json = Record<string, unknown>;
type Outcome = 'applied' | 'duplicate';

/** A record the server understood but will not apply; its message becomes ingest_rejects.error. */
class Unusable extends Error {}

const NOTHING: IngestResult = { ack: null, applied: 0, duplicates: 0, rejected: 0 };
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

function text(v: unknown, field: string): string {
  if (typeof v !== 'string' || v === '') throw new Unusable(`${field} must be a non-empty string`);
  return v;
}
function optionalText(v: unknown, field: string): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') throw new Unusable(`${field} must be a string or null`);
  return v;
}
function seconds(v: unknown, field: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw new Unusable(`${field} must be a time in epoch seconds`);
  return v;
}

/**
 * Applies what a workstation recorded while deciding on its own (D-015). The edge is the authority on what happened;
 * the server stores it, removes duplicates and never lets one bad record hold back the rest of a workstation's log.
 */
@Injectable()
export class IngestService {
  private readonly logger = new Logger('Ingest');

  constructor(
    @Inject(KYSELY) private readonly db: Db,
    private readonly vault: UidVault,
    @Inject(MASTER_KEY) private readonly masterKey: Buffer,
  ) {}

  async handleOutbox(identity: string, raw: Buffer, signature: string | undefined): Promise<IngestResult> {
    // D-030: the batch must come from the workstation itself; otherwise a broker could have the server sign an ACK
    // that makes the edge delete records it never delivered.
    const keyRow = (
      await sql<{ key_version: number }>`SELECT key_version FROM workstations WHERE mqtt_identity = ${identity}`.execute(this.db)
    ).rows[0];
    if (!keyRow) {
      this.logger.warn(`outbox of ${identity} ignored: unknown workstation`);
      return NOTHING;
    }
    let signatureValid = false;
    try {
      signatureValid = !!signature && verify(deriveKm(this.masterKey, identity, keyRow.key_version), 'outbox-v1', raw, signature);
    } catch {
      signatureValid = false;
    }
    if (!signatureValid) {
      this.logger.warn(`outbox of ${identity} ignored: missing or wrong signature`);
      return NOTHING;
    }

    let batch: unknown;
    try {
      batch = JSON.parse(raw.toString('utf8'));
    } catch {
      this.logger.warn(`outbox of ${identity} ignored: not JSON`);
      return NOTHING;
    }
    if (
      !isObject(batch) ||
      !(typeof batch.batch_id === 'string' && batch.batch_id.length >= 1 && batch.batch_id.length <= 64) ||
      !Number.isInteger(batch.to_seq) ||
      (batch.to_seq as number) < 1 ||
      !Array.isArray(batch.records)
    ) {
      this.logger.warn(`outbox of ${identity} ignored: no usable to_seq / records`);
      return NOTHING;
    }
    if (batch.workstation_id !== identity) {
      this.logger.warn(`outbox of ${identity} ignored: payload names ${String(batch.workstation_id)}`);
      return NOTHING;
    }
    const toSeq = batch.to_seq as number;
    const records = batch.records as unknown[];

    const result = await this.db.transaction().execute(async (trx) => {
      const workstation = (
        await sql<WorkstationRow>`
          SELECT w.id, w.mqtt_identity, w.key_version, w.hostname, w.zone_id, z.name AS zone_name
          FROM workstations w LEFT JOIN zones z ON z.id = w.zone_id
          WHERE w.mqtt_identity = ${identity}
          FOR UPDATE OF w
        `.execute(trx)
      ).rows[0];
      // D-030: a reinstall approved between the signature check and this lock replaced the key that signed the batch.
      if (!workstation || workstation.key_version !== keyRow.key_version) return null;
      const counts = { applied: 0, duplicates: 0, rejected: 0 };
      for (const record of records) {
        await sql`SAVEPOINT outbox_record`.execute(trx);
        try {
          const outcome = await this.apply(trx, workstation, record);
          await sql`RELEASE SAVEPOINT outbox_record`.execute(trx);
          if (outcome === 'applied') counts.applied += 1;
          else counts.duplicates += 1;
        } catch (err) {
          // Anything else the database refuses (bad uuid, unknown enum value, missing user) is a rejected record too.
          await sql`ROLLBACK TO SAVEPOINT outbox_record`.execute(trx);
          await this.reject(trx, workstation.id, record, err instanceof Error ? err.message : String(err));
          counts.rejected += 1;
        }
      }
      return { workstation, counts };
    });
    if (!result) {
      this.logger.warn(`outbox of ${identity} ignored: unknown workstation or its key changed while the batch was checked`);
      return NOTHING;
    }
    if (result.counts.rejected > 0) this.logger.warn(`outbox of ${identity}: ${result.counts.rejected} record(s) rejected, see ingest_rejects`);
    return { ack: this.ack(result.workstation, toSeq, batch.batch_id as string), ...result.counts };
  }

  private async apply(db: Db, w: WorkstationRow, record: unknown): Promise<Outcome> {
    if (!isObject(record) || !isObject(record.payload)) throw new Unusable('record must be an object with a payload');
    const entryId = text(record.entry_id, 'entry_id');
    const occurredAt = seconds(record.occurred_at, 'occurred_at');
    const payload = record.payload;
    switch (record.event_type) {
      case 'swipe_decision':
        return this.swipe(db, w, entryId, occurredAt, payload);
      case 'session_started':
        return this.sessionStarted(db, w, payload);
      case 'session_ended':
        return this.sessionEnded(db, w, payload);
      case 'security_alert':
        return this.alert(db, w, entryId, occurredAt, payload);
      default:
        throw new Unusable(`unknown event_type ${String(record.event_type)}`);
    }
  }

  /** BR-007: exactly one audit row per swipe; the row is immutable (append-only trigger). */
  private async swipe(db: Db, w: WorkstationRow, entryId: string, occurredAt: number, p: Json): Promise<Outcome> {
    const cardUid = optionalText(p.card_uid, 'card_uid');
    let uid: { ciphertext: Buffer; iv: Buffer; authTag: Buffer; keyId: string } | null = null;
    let uidIndex: string | null = null;
    if (cardUid !== null) {
      let normalized: string;
      try {
        normalized = normalizeUid(cardUid);
      } catch {
        throw new Unusable('card_uid is not a 4, 7 or 10 byte UID');
      }
      uid = this.vault.encrypt(normalized);
      uidIndex = this.vault.index(normalized);
    }
    const schedules = Array.isArray(p.matched_schedule_ids) ? p.matched_schedule_ids.map((id) => text(id, 'matched_schedule_ids')) : null;
    // What the workstation was called and where it stood when the record arrived; never re-read later (audit stays true).
    const workstationSnapshot = {
      id: w.id,
      mqtt_identity: w.mqtt_identity,
      hostname: w.hostname,
      zone: w.zone_id === null ? null : { id: w.zone_id, name: w.zone_name },
    };
    const inserted = (
      await sql<{ id: string }>`
        INSERT INTO audit_logs
          (entry_id, occurred_at, workstation_id, outcome, reason, detail,
           card_uid_encrypted, card_uid_iv, card_uid_auth_tag, encryption_key_id, card_uid_index, reader_raw,
           user_snapshot, card_snapshot, workstation_snapshot, target_os_username, data_version, matched_schedule_ids)
        VALUES
          (${entryId}::uuid, to_timestamp(${occurredAt}::double precision), ${w.id}::uuid, ${text(p.outcome, 'outcome')}, ${text(p.reason, 'reason')},
           ${optionalText(p.detail, 'detail')},
           ${uid?.ciphertext ?? null}, ${uid?.iv ?? null}, ${uid?.authTag ?? null}, ${uid?.keyId ?? null}, ${uidIndex},
           ${optionalText(p.reader_raw, 'reader_raw')},
           ${isObject(p.user) ? JSON.stringify(p.user) : null}::jsonb, ${isObject(p.card) ? JSON.stringify(p.card) : null}::jsonb,
           ${JSON.stringify(workstationSnapshot)}::jsonb, ${optionalText(p.target_os_username, 'target_os_username')},
           ${Number.isInteger(p.data_version) ? (p.data_version as number) : null}::bigint,
           ${schedules === null ? null : sql`string_to_array(${schedules.join(',')}, ',')::uuid[]`})
        ON CONFLICT (entry_id) DO NOTHING
        RETURNING id
      `.execute(db)
    ).rows;
    return inserted.length > 0 ? 'applied' : 'duplicate';
  }

  /** D-015.3: a new session of a workstation means its previous one ended without the server hearing of it. */
  private async sessionStarted(db: Db, w: WorkstationRow, p: Json): Promise<Outcome> {
    const sessionId = text(p.session_id, 'session_id');
    const decisionId = text(p.decision_entry_id, 'decision_entry_id');
    const startedAt = seconds(p.started_at, 'started_at');
    const known = (
      await sql`SELECT 1 FROM sessions WHERE id = ${sessionId}::uuid OR decision_id = ${decisionId}::uuid`.execute(db)
    ).rows;
    // Checked first: a resent old record must not close the session that is active now.
    if (known.length > 0) return 'duplicate';
    await sql`
      UPDATE sessions
      SET status = 'abandoned', end_reason = 'os_session_lost', end_source = 'inferred',
          ended_at = GREATEST(started_at, to_timestamp(${startedAt}::double precision))
      WHERE workstation_id = ${w.id}::uuid AND status = 'active'
    `.execute(db);
    await sql`
      INSERT INTO sessions (id, decision_id, user_id, card_id, workstation_id, os_username, boot_id, decided_at, started_at, expires_at)
      VALUES (${sessionId}::uuid, ${decisionId}::uuid, ${text(p.user_id, 'user_id')}::uuid, ${optionalText(p.card_id, 'card_id')}::uuid,
              ${w.id}::uuid, ${text(p.os_username, 'os_username')}, ${text(p.boot_id, 'boot_id')},
              to_timestamp(${seconds(p.decided_at, 'decided_at')}::double precision), to_timestamp(${startedAt}::double precision),
              to_timestamp(${seconds(p.expires_at, 'expires_at')}::double precision))
    `.execute(db);
    return 'applied';
  }

  /** INV-007 / D-015.1: a real report closes an active session, or replaces an inferred end once; then it never changes. */
  private async sessionEnded(db: Db, w: WorkstationRow, p: Json): Promise<Outcome> {
    const sessionId = text(p.session_id, 'session_id');
    const updated = (
      await sql<{ id: string }>`
        UPDATE sessions
        SET status = ${text(p.status, 'status')}, end_reason = ${text(p.end_reason, 'end_reason')}, end_source = ${text(p.end_source, 'end_source')},
            ended_at = to_timestamp(${seconds(p.ended_at, 'ended_at')}::double precision)
        WHERE id = ${sessionId}::uuid AND workstation_id = ${w.id}::uuid AND (status = 'active' OR end_source = 'inferred')
        RETURNING id
      `.execute(db)
    ).rows;
    if (updated.length > 0) return 'applied';
    const exists = (await sql`SELECT 1 FROM sessions WHERE id = ${sessionId}::uuid AND workstation_id = ${w.id}::uuid`.execute(db)).rows;
    if (exists.length === 0) throw new Unusable('session_ended for a session the server does not know');
    return 'duplicate';
  }

  private async alert(db: Db, w: WorkstationRow, entryId: string, occurredAt: number, p: Json): Promise<Outcome> {
    const inserted = (
      await sql<{ id: string }>`
        INSERT INTO workstation_alerts (entry_id, workstation_id, kind, detail, occurred_at)
        VALUES (${entryId}::uuid, ${w.id}::uuid, ${text(p.kind, 'kind')}, ${isObject(p.detail) ? JSON.stringify(p.detail) : null}::jsonb,
                to_timestamp(${occurredAt}::double precision))
        ON CONFLICT (entry_id) DO NOTHING
        RETURNING id
      `.execute(db)
    ).rows;
    return inserted.length > 0 ? 'applied' : 'duplicate';
  }

  /** D-015.2: kept verbatim for the admin. The same record of a resent batch is stored once. */
  private async reject(db: Db, workstationId: string, record: unknown, error: string): Promise<void> {
    const raw = JSON.stringify(this.redact(record ?? null));
    const entryId = isObject(record) && typeof record.entry_id === 'string' ? record.entry_id.slice(0, 64) : null;
    const seq = isObject(record) && Number.isInteger(record.outbox_seq) ? (record.outbox_seq as number) : null;
    await sql`
      INSERT INTO ingest_rejects (workstation_id, entry_id, outbox_seq, raw_record, error)
      SELECT ${workstationId}::uuid, ${entryId}, ${seq}::bigint, ${raw}::jsonb, ${error.slice(0, 255)}
      WHERE NOT EXISTS (
        SELECT 1 FROM ingest_rejects WHERE workstation_id = ${workstationId}::uuid AND raw_record = ${raw}::jsonb
      )
    `.execute(db);
  }

  /** NFR-SEC03: no card UID is stored in the clear, rejected records included; the blind index keeps it searchable. */
  private redact(record: unknown): unknown {
    if (!isObject(record) || !isObject(record.payload) || typeof record.payload.card_uid !== 'string') return record;
    let index: string | null = null;
    try {
      index = this.vault.index(normalizeUid(record.payload.card_uid));
    } catch {
      index = null;
    }
    return { ...record, payload: { ...record.payload, card_uid: '[redacted]', card_uid_index: index } };
  }

  /** events.md §4.3: cumulative, so a lost ACK is repaired by the next one (INV-013). */
  private ack(w: WorkstationRow, ackedSeq: number, batchId: string): OutgoingMessage {
    const payload = Buffer.from(
      JSON.stringify({ schema: 'ack-v1', command: 'ack_outbox', workstation_id: w.mqtt_identity, batch_id: batchId, acked_seq: ackedSeq }),
      'utf8',
    );
    const km = deriveKm(this.masterKey, w.mqtt_identity, w.key_version);
    return { topic: `lab/workstation/${w.mqtt_identity}/command/ack`, payload, signature: sign(km, 'ack-v1', payload), retain: false };
  }
}
