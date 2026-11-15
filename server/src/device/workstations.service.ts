import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { Db, KYSELY } from '../infra/database/database.module';
import { ProfileStatus } from '../infra/database/schema';
import { recordAdminAction } from '../shared/admin-audit';
import { AppError } from '../shared/http/app-error';
import { emitEvent } from '../shared/outbox';
import { PkiService } from './pki.service';

export type WorkstationStatus = 'enrolled' | 'disabled';
export type Connectivity = 'online' | 'offline';
export type SyncState = 'in_sync' | 'pending' | 'stuck';
export type WorkstationFlag = 'overdue_session' | 'stuck_sync' | 'apply_error' | 'missing_profile' | 'ingest_rejects' | 'security_alert';

export const PROFILE_NAME_PATTERN = /^[a-z_][a-z0-9_-]{0,31}$/;

export interface WorkstationSummary {
  id: string;
  mqtt_identity: string;
  hostname: string;
  zone: { id: string; name: string } | null;
  status: WorkstationStatus;
  connectivity: Connectivity;
  last_heartbeat_at: Date | null;
  trust_state: string | null;
  clock_skew_detected: boolean;
  sync: { state: SyncState; desired_version: number; acked_version: number };
  current_session: { user: { external_id: string; full_name: string }; started_at: Date; expires_at: Date } | null;
  flags: WorkstationFlag[];
}

export interface ProfileView {
  os_username: string;
  display_name: string;
  profile_type: string;
  is_default: boolean;
  status: ProfileStatus;
  description: string | null;
  discovered_at: Date;
  updated_at: Date;
}

export interface WorkstationDetail extends WorkstationSummary {
  machine_id: string;
  mac_address: string;
  key_version: number;
  cert_expires_at: Date | null;
  last_apply_error: string | null;
  created_at: Date;
  updated_at: Date;
  profiles: ProfileView[];
}

export interface WorkstationFilter {
  id?: string;
  zoneId?: string;
  status?: WorkstationStatus;
  connectivity?: Connectivity;
  sync?: SyncState;
}

export interface ProfileChanges {
  status?: ProfileStatus;
  is_default?: boolean;
}

interface Row {
  id: string;
  mqtt_identity: string;
  hostname: string;
  machine_id: string;
  mac_address: string;
  status: WorkstationStatus;
  key_version: number;
  cert_expires_at: Date | null;
  created_at: Date;
  updated_at: Date;
  zone_id: string | null;
  zone_name: string | null;
  connectivity: Connectivity;
  last_heartbeat_at: Date | null;
  trust_state: string | null;
  clock_skew_detected: boolean;
  last_apply_error: string | null;
  desired_version: number;
  acked_version: number;
  behind: boolean;
  stuck: boolean;
  session_started_at: Date | null;
  session_expires_at: Date | null;
  session_external_id: string | null;
  session_full_name: string | null;
  overdue_session: boolean;
  has_ingest_rejects: boolean;
  has_alert: boolean;
  missing_profile: boolean;
}

const notFound = (): AppError => new AppError('NOT_FOUND', 'Workstation not found');
const profileNotFound = (): AppError => new AppError('NOT_FOUND', 'Profile not found');

const PROFILE_COLUMNS = ['os_username', 'display_name', 'profile_type', 'is_default', 'status', 'description', 'discovered_at', 'updated_at'] as const;

function toSummary(r: Row): WorkstationSummary {
  const flags: WorkstationFlag[] = [];
  if (r.overdue_session) flags.push('overdue_session');
  if (r.stuck) flags.push('stuck_sync');
  if (r.last_apply_error !== null) flags.push('apply_error');
  if (r.missing_profile) flags.push('missing_profile');
  if (r.has_ingest_rejects) flags.push('ingest_rejects');
  if (r.has_alert) flags.push('security_alert');
  return {
    id: r.id,
    mqtt_identity: r.mqtt_identity,
    hostname: r.hostname,
    zone: r.zone_id !== null ? { id: r.zone_id, name: r.zone_name ?? '' } : null,
    status: r.status,
    connectivity: r.connectivity,
    last_heartbeat_at: r.last_heartbeat_at,
    trust_state: r.trust_state,
    clock_skew_detected: r.clock_skew_detected,
    sync: { state: r.stuck ? 'stuck' : r.behind ? 'pending' : 'in_sync', desired_version: r.desired_version, acked_version: r.acked_version },
    current_session:
      r.session_started_at !== null && r.session_expires_at !== null
        ? {
            user: { external_id: r.session_external_id ?? '', full_name: r.session_full_name ?? '' },
            started_at: r.session_started_at,
            expires_at: r.session_expires_at,
          }
        : null,
    flags,
  };
}

@Injectable()
export class WorkstationsService {
  constructor(
    @Inject(KYSELY) private readonly db: Db,
    private readonly pki: PkiService,
  ) {}

  /**
   * One row per workstation with everything the room view shows (FR-042, FR-062). Thresholds are those of
   * 11-operations/deployment.md "Bảng Tham Số": stuck sync and overdue session after 10 minutes, alerts kept visible 7 days.
   * A workstation without status or sync rows (never connected) reads as offline and in sync at version 0.
   */
  private async rows(db: Db, filter: WorkstationFilter): Promise<Row[]> {
    const id = filter.id ?? null;
    const zoneId = filter.zoneId ?? null;
    const status = filter.status ?? null;
    const connectivity = filter.connectivity ?? null;
    const result = await sql<Row>`
      SELECT
        w.id, w.mqtt_identity, w.hostname, w.machine_id, w.mac_address::text AS mac_address, w.status, w.key_version,
        w.cert_expires_at, w.created_at, w.updated_at, w.zone_id, z.name AS zone_name,
        coalesce(st.connectivity, 'offline') AS connectivity, st.last_heartbeat_at, st.trust_state,
        coalesce(st.clock_skew_detected, false) AS clock_skew_detected, st.last_apply_error,
        coalesce(sy.desired_version, 0)::int AS desired_version, coalesce(sy.acked_version, 0)::int AS acked_version,
        coalesce(sy.acked_version < sy.desired_version, false) AS behind,
        coalesce(sy.acked_version < sy.desired_version AND st.connectivity = 'online'
                 AND sy.desired_updated_at < now() - interval '10 minutes', false) AS stuck,
        se.started_at AS session_started_at, se.expires_at AS session_expires_at,
        su.external_id AS session_external_id, su.full_name AS session_full_name,
        coalesce(now() > se.expires_at + interval '10 minutes', false) AS overdue_session,
        EXISTS (SELECT 1 FROM ingest_rejects r WHERE r.workstation_id = w.id AND r.resolved_at IS NULL) AS has_ingest_rejects,
        EXISTS (SELECT 1 FROM workstation_alerts a WHERE a.workstation_id = w.id AND a.received_at > now() - interval '7 days') AS has_alert,
        EXISTS (
          SELECT 1 FROM schedules s
          WHERE s.status = 'enabled' AND (s.target_workstation_id = w.id OR s.target_zone_id = w.zone_id)
            AND NOT EXISTS (
              SELECT 1 FROM workstation_profiles p
              WHERE p.workstation_id = w.id AND p.status = 'enabled'
                AND ((s.target_os_username IS NULL AND p.is_default) OR p.os_username = s.target_os_username)
            )
        ) AS missing_profile
      FROM workstations w
      LEFT JOIN zones z ON z.id = w.zone_id
      LEFT JOIN workstation_statuses st ON st.workstation_id = w.id
      LEFT JOIN sync_states sy ON sy.workstation_id = w.id
      LEFT JOIN sessions se ON se.workstation_id = w.id AND se.status = 'active'
      LEFT JOIN users su ON su.id = se.user_id
      WHERE (${id}::uuid IS NULL OR w.id = ${id}::uuid)
        AND (${zoneId}::uuid IS NULL OR w.zone_id = ${zoneId}::uuid)
        AND (${status}::text IS NULL OR w.status = ${status}::text)
        AND (${connectivity}::text IS NULL OR coalesce(st.connectivity, 'offline') = ${connectivity}::text)
      ORDER BY w.mqtt_identity
    `.execute(db);
    return result.rows;
  }

  private profilesOf(db: Db, id: string): Promise<ProfileView[]> {
    return db.selectFrom('workstation_profiles').select(PROFILE_COLUMNS).where('workstation_id', '=', id).orderBy('os_username').execute();
  }

  private async detail(db: Db, id: string): Promise<WorkstationDetail> {
    const [row] = await this.rows(db, { id });
    if (!row) throw notFound();
    return {
      ...toSummary(row),
      machine_id: row.machine_id,
      mac_address: row.mac_address,
      key_version: row.key_version,
      cert_expires_at: row.cert_expires_at,
      last_apply_error: row.last_apply_error,
      created_at: row.created_at,
      updated_at: row.updated_at,
      profiles: await this.profilesOf(db, id),
    };
  }

  async list(filter: WorkstationFilter): Promise<WorkstationSummary[]> {
    const summaries = (await this.rows(this.db, filter)).map(toSummary);
    return filter.sync ? summaries.filter((s) => s.sync.state === filter.sync) : summaries;
  }

  get(id: string): Promise<WorkstationDetail> {
    return this.detail(this.db, id);
  }

  /** FR-041, BR-015: a workstation is in at most one zone; `null` takes it out of its zone. */
  async setZone(id: string, zoneId: string | null, actorId: string): Promise<WorkstationDetail> {
    return this.db.transaction().execute(async (trx) => {
      const current = await trx.selectFrom('workstations').select('zone_id').where('id', '=', id).forUpdate().executeTakeFirst();
      if (!current) throw notFound();
      if (zoneId !== current.zone_id) {
        if (zoneId !== null) {
          // FOR SHARE: the zone cannot be deleted before this transaction commits.
          const zone = await trx.selectFrom('zones').select('id').where('id', '=', zoneId).forShare().executeTakeFirst();
          if (!zone) throw new AppError('VALIDATION_ERROR', 'Zone does not exist', [{ field: 'zone_id', constraints: ['zone not found'] }]);
        }
        const change = { before: { zone_id: current.zone_id }, after: { zone_id: zoneId } };
        await trx.updateTable('workstations').set({ zone_id: zoneId, updated_at: new Date() }).where('id', '=', id).execute();
        await recordAdminAction(trx, { adminId: actorId, action: 'workstation.update', entityType: 'workstation', entityId: id, ...change });
        await emitEvent(trx, { aggregateType: 'workstation', aggregateId: id, eventType: 'WorkstationZoneChanged', payload: change });
      }
      return this.detail(trx, id);
    });
  }

  /**
   * D-014.5/.6: revokes the workstation's certificate. It keeps accepting cards from its local snapshot until its lease
   * runs out (at most 24h); it comes back only by re-enrolling and being approved as a reinstall.
   */
  async disable(id: string, actorId: string): Promise<WorkstationDetail> {
    const changed = await this.db.transaction().execute(async (trx) => {
      const current = (
        await sql<{ status: WorkstationStatus; cert_serial: string | null }>`
          SELECT status, cert_serial FROM workstations WHERE id = ${id}::uuid FOR UPDATE
        `.execute(trx)
      ).rows[0];
      if (!current) throw notFound();
      if (current.status === 'disabled') return false;
      await sql`UPDATE workstations SET status = 'disabled', updated_at = now() WHERE id = ${id}::uuid`.execute(trx);
      if (current.cert_serial !== null) {
        await sql`
          INSERT INTO revoked_certificates (cert_serial, workstation_id, reason)
          VALUES (${current.cert_serial}, ${id}::uuid, 'disabled')
          ON CONFLICT (cert_serial) DO NOTHING
        `.execute(trx);
      }
      await recordAdminAction(trx, {
        adminId: actorId,
        action: 'workstation.disable',
        entityType: 'workstation',
        entityId: id,
        before: { status: 'enrolled' },
        after: { status: 'disabled', revoked_cert_serial: current.cert_serial },
      });
      return true;
    });
    // After commit: the broker reads the CRL file, not the database (S9).
    if (changed) await this.pki.revocationChanged();
    return this.detail(this.db, id);
  }

  async profiles(id: string): Promise<ProfileView[]> {
    const workstation = await this.db.selectFrom('workstations').select('id').where('id', '=', id).executeTakeFirst();
    if (!workstation) throw notFound();
    return this.profilesOf(this.db, id);
  }

  /**
   * FR-007: enable/disable a discovered profile or choose the default one. At most one default per workstation
   * (uq_ws_default_profile), so the previous default is cleared first; the workstation row lock serialises concurrent changes.
   */
  async updateProfile(id: string, osUsername: string, changes: ProfileChanges, actorId: string): Promise<ProfileView> {
    return this.db.transaction().execute(async (trx) => {
      const workstation = await trx.selectFrom('workstations').select('id').where('id', '=', id).forUpdate().executeTakeFirst();
      if (!workstation) throw notFound();
      const current = await trx
        .selectFrom('workstation_profiles')
        .select(['id', 'status', 'is_default'])
        .where('workstation_id', '=', id)
        .where('os_username', '=', osUsername)
        .executeTakeFirst();
      if (!current) throw profileNotFound();
      const set: ProfileChanges = {};
      const before: ProfileChanges = {};
      if (changes.status !== undefined && changes.status !== current.status) {
        set.status = changes.status;
        before.status = current.status;
      }
      if (changes.is_default !== undefined && changes.is_default !== current.is_default) {
        set.is_default = changes.is_default;
        before.is_default = current.is_default;
      }
      if (Object.keys(set).length > 0) {
        const now = new Date();
        if (set.is_default === true) {
          await trx
            .updateTable('workstation_profiles')
            .set({ is_default: false, updated_at: now })
            .where('workstation_id', '=', id)
            .where('is_default', '=', true)
            .execute();
        }
        await trx.updateTable('workstation_profiles').set({ ...set, updated_at: now }).where('id', '=', current.id).execute();
        const change = { os_username: osUsername, before, after: set };
        await recordAdminAction(trx, {
          adminId: actorId,
          action: 'workstation.profile_update',
          entityType: 'workstation',
          entityId: id,
          before: { os_username: osUsername, ...before },
          after: { os_username: osUsername, ...set },
        });
        await emitEvent(trx, { aggregateType: 'workstation', aggregateId: id, eventType: 'WorkstationProfileConfigured', payload: change });
      }
      return trx.selectFrom('workstation_profiles').select(PROFILE_COLUMNS).where('id', '=', current.id).executeTakeFirstOrThrow();
    });
  }
}
