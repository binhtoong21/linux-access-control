import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'kysely';
import { Db, KYSELY } from '../infra/database/database.module';
import { MASTER_KEY } from '../infra/keys.module';
import { deriveKm } from '../shared/crypto/crypto-v1';
import { UidVault } from '../shared/crypto/uid-vault';
import { canonicalContent, contentHash, encodeSnapshot, SnapshotData } from './snapshot-content';

/** 11-operations/deployment.md "Bảng Tham Số": older snapshots are only kept for troubleshooting. */
export const SNAPSHOTS_KEPT = 5;

export interface ReconcileResult {
  workstation_id: string;
  mqtt_identity: string;
  /** The version just issued; null when the content was unchanged or the build failed. */
  version: number | null;
  /** Set when building this workstation's snapshot failed; the other workstations are not affected. */
  error?: string;
}

interface WorkstationRow {
  id: string;
  mqtt_identity: string;
  key_version: number;
  zone_id: string | null;
  status: string;
}

interface ScheduleRow {
  id: string;
  subject_type: 'user' | 'group';
  subject_user_id: string | null;
  subject_group_id: string | null;
  valid_from: string;
  valid_to: string | null;
  days_of_week: string[];
  start_minute: number;
  end_minute: number;
  target_os_username: string | null;
}

interface CardRow {
  id: string;
  user_id: string;
  status: 'active' | 'disabled';
  uid_encrypted: Buffer;
  uid_iv: Buffer;
  uid_auth_tag: Buffer;
  encryption_key_id: string;
}

// uuid lists travel as one comma-separated text parameter; '' gives an empty array.
const uuids = (ids: string[]) => sql`string_to_array(${ids.join(',')}, ',')::uuid[]`;

@Injectable()
export class SnapshotService {
  private readonly logger = new Logger('Snapshot');

  constructor(
    @Inject(KYSELY) private readonly db: Db,
    private readonly vault: UidVault,
    @Inject(MASTER_KEY) private readonly masterKey: Buffer,
  ) {}

  /** Reconcile(workstation) of schedule-sync.md: level-triggered, so calling it more often than needed is harmless. */
  async reconcile(workstationId: string): Promise<number | null> {
    return this.db.transaction().execute(async (trx) => {
      // The row lock makes builds of one workstation sequential: versions follow the order the content was read in.
      const workstation = (
        await sql<WorkstationRow>`
          SELECT id, mqtt_identity, key_version, zone_id, status FROM workstations WHERE id = ${workstationId}::uuid FOR UPDATE
        `.execute(trx)
      ).rows[0];
      if (!workstation || workstation.status !== 'enrolled') return null;

      const km = deriveKm(this.masterKey, workstation.mqtt_identity, workstation.key_version);
      const content = canonicalContent(await this.load(trx, workstation), km);
      const hash = contentHash(content);

      const state = (
        await sql<{ newest_version: number; newest_hash: string | null; desired: number; acked: number }>`
          SELECT
            coalesce((SELECT max(version) FROM snapshots WHERE workstation_id = ${workstationId}::uuid), 0)::int AS newest_version,
            (SELECT content_hash::text FROM snapshots WHERE workstation_id = ${workstationId}::uuid ORDER BY version DESC LIMIT 1) AS newest_hash,
            coalesce((SELECT desired_version FROM sync_states WHERE workstation_id = ${workstationId}::uuid), 0)::int AS desired,
            coalesce((SELECT acked_version FROM sync_states WHERE workstation_id = ${workstationId}::uuid), 0)::int AS acked
        `.execute(trx)
      ).rows[0];
      // EF-4b: a workstation ahead of everything stored here refuses our versions as "older", so it needs a newer one.
      const workstationAhead = state.acked > state.newest_version;
      if (state.newest_hash === hash && !workstationAhead) return null;

      const version = Math.max(state.newest_version, state.desired, state.acked) + 1;
      const signed = encodeSnapshot(content, km, version, Date.now() / 1000);
      await sql`
        INSERT INTO snapshots (workstation_id, version, key_version, content_hash, payload_raw, hmac_signature)
        VALUES (${workstationId}::uuid, ${version}, ${workstation.key_version}, ${hash}, ${signed.raw}, ${signed.signature})
      `.execute(trx);
      await sql`
        INSERT INTO sync_states (workstation_id, desired_version, desired_updated_at)
        VALUES (${workstationId}::uuid, ${version}, now())
        ON CONFLICT (workstation_id) DO UPDATE SET desired_version = EXCLUDED.desired_version, desired_updated_at = now()
      `.execute(trx);
      await sql`
        DELETE FROM snapshots
        WHERE workstation_id = ${workstationId}::uuid
          AND version NOT IN (
            SELECT version FROM snapshots WHERE workstation_id = ${workstationId}::uuid ORDER BY version DESC LIMIT ${SNAPSHOTS_KEPT}
          )
      `.execute(trx);
      return version;
    });
  }

  /** Every enrolled workstation in turn (MVP: no narrowing by event). One failing workstation does not stop the others. */
  async reconcileAll(): Promise<ReconcileResult[]> {
    const workstations = (
      await sql<{ id: string; mqtt_identity: string }>`
        SELECT id, mqtt_identity FROM workstations WHERE status = 'enrolled' ORDER BY mqtt_identity
      `.execute(this.db)
    ).rows;
    const results: ReconcileResult[] = [];
    for (const w of workstations) {
      try {
        results.push({ workstation_id: w.id, mqtt_identity: w.mqtt_identity, version: await this.reconcile(w.id) });
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        this.logger.error(`snapshot of ${w.mqtt_identity} failed: ${error}`);
        results.push({ workstation_id: w.id, mqtt_identity: w.mqtt_identity, version: null, error });
      }
    }
    return results;
  }

  /** INV-012: only what this workstation needs to decide a swipe. */
  private async load(db: Db, w: WorkstationRow): Promise<SnapshotData> {
    const schedules = (
      await sql<ScheduleRow>`
        SELECT id, subject_type, subject_user_id, subject_group_id,
               to_char(valid_from, 'YYYY-MM-DD') AS valid_from, to_char(valid_to, 'YYYY-MM-DD') AS valid_to,
               days_of_week, start_minute, end_minute, target_os_username
        FROM schedules
        WHERE status = 'enabled' AND (target_workstation_id = ${w.id}::uuid OR target_zone_id = ${w.zone_id}::uuid)
      `.execute(db)
    ).rows;
    const groupIds = [...new Set(schedules.map((s) => s.subject_group_id).filter((g): g is string => g !== null))];
    const directUserIds = [...new Set(schedules.map((s) => s.subject_user_id).filter((u): u is string => u !== null))];

    // FR-050: inactive users stay in the snapshot so the Agent can answer user_inactive instead of unknown_card.
    const users = (
      await sql<{ id: string; external_id: string; full_name: string; status: 'active' | 'inactive'; group_ids: string[] }>`
        SELECT u.id, u.external_id, u.full_name, u.status,
               coalesce((SELECT array_agg(gm.group_id::text) FROM group_members gm
                          WHERE gm.user_id = u.id AND gm.group_id = ANY(${uuids(groupIds)})), '{}') AS group_ids
        FROM users u
        WHERE u.id = ANY(${uuids(directUserIds)})
           OR EXISTS (SELECT 1 FROM group_members gm WHERE gm.user_id = u.id AND gm.group_id = ANY(${uuids(groupIds)}))
      `.execute(db)
    ).rows;

    // Disabled cards stay too (card_disabled); unbound cards have no owner and are never in a snapshot.
    const cards = (
      await sql<CardRow>`
        SELECT id, owner_id AS user_id, status, uid_encrypted, uid_iv, uid_auth_tag, encryption_key_id
        FROM cards
        WHERE status IN ('active', 'disabled') AND owner_id = ANY(${uuids(users.map((u) => u.id))})
      `.execute(db)
    ).rows;

    const profiles = (
      await sql<{ os_username: string; status: 'enabled' | 'disabled'; is_default: boolean }>`
        SELECT os_username, status, is_default FROM workstation_profiles WHERE workstation_id = ${w.id}::uuid
      `.execute(db)
    ).rows;

    return {
      mqttIdentity: w.mqtt_identity,
      keyVersion: w.key_version,
      users,
      cards: cards.map((c) => ({
        id: c.id,
        user_id: c.user_id,
        status: c.status,
        uid: this.vault.decrypt({ ciphertext: c.uid_encrypted, iv: c.uid_iv, authTag: c.uid_auth_tag, keyId: c.encryption_key_id }),
      })),
      schedules: schedules.map((s) => ({
        id: s.id,
        subject_type: s.subject_type,
        subject_id: (s.subject_user_id ?? s.subject_group_id) as string,
        valid_from: s.valid_from,
        valid_to: s.valid_to,
        days_of_week: s.days_of_week,
        start_minute: s.start_minute,
        end_minute: s.end_minute,
        target_os_username: s.target_os_username,
      })),
      profiles,
    };
  }
}
