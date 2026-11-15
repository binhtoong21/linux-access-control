import { Inject, Injectable } from '@nestjs/common';
import { RawBuilder, sql } from 'kysely';
import { Db, KYSELY } from '../infra/database/database.module';
import { recordAdminAction } from '../shared/admin-audit';
import { InvalidUidError, normalizeUid } from '../shared/crypto/crypto-v1';
import { UidVault } from '../shared/crypto/uid-vault';
import { AppError } from '../shared/http/app-error';
import { decodeCursor, Page, PAGE_LIMIT_DEFAULT, toPage } from '../shared/http/pagination';

type Cond = RawBuilder<unknown>;

export interface PageArgs {
  limit?: number;
  cursor?: string;
}
export interface TimeRange {
  from?: string;
  to?: string;
}
export interface AuditFilter extends PageArgs, TimeRange {
  userId?: string;
  workstationId?: string;
  zoneId?: string;
  outcome?: string;
  reason?: string;
  cardUid?: string;
}
export interface SessionFilter extends PageArgs, TimeRange {
  workstationId?: string;
  userId?: string;
  status?: string;
}
export interface RejectFilter extends PageArgs {
  workstationId?: string;
  resolved?: 'true' | 'false' | 'all';
}
export interface AlertFilter extends PageArgs {
  workstationId?: string;
  from?: string;
}
export interface AdminAuditFilter extends PageArgs, TimeRange {
  adminId?: string;
  entityType?: string;
  entityId?: string;
}

export interface AuditLogView {
  id: string;
  entry_id: string;
  occurred_at: Date;
  received_at: Date;
  outcome: string;
  reason: string;
  detail: string | null;
  user: unknown;
  card: unknown;
  workstation: unknown;
  target_os_username: string | null;
  data_version: number | null;
  matched_schedule_ids: string[] | null;
  has_card_uid: boolean;
}
export interface AuditLogDetail extends AuditLogView {
  card_uid: string | null;
  reader_raw: string | null;
}

const SORT_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BIGINT = /^\d{1,19}$/;

const badCursor = (): AppError =>
  new AppError('VALIDATION_ERROR', 'Request validation failed', [{ field: 'cursor', constraints: ['cursor is invalid'] }]);
const where = (conds: (Cond | null)[]): Cond => {
  const present = conds.filter((c): c is Cond => c !== null);
  return present.length > 0 ? sql.join(present, sql` AND `) : sql`true`;
};
const eq = (column: string, value: string | undefined, cast = 'uuid'): Cond | null =>
  value === undefined ? null : sql`${sql.raw(column)} = ${value}::${sql.raw(cast)}`;
const range = (column: string, r: TimeRange): Cond[] => [
  r.from === undefined ? null : sql`${sql.raw(column)} >= ${r.from}::timestamptz`,
  r.to === undefined ? null : sql`${sql.raw(column)} < ${r.to}::timestamptz`,
].filter((c): c is Cond => c !== null);
// The sort key travels in the cursor with microseconds, so two rows inside one millisecond keep their order.
const sortTime = (column: string): Cond => sql`to_char(${sql.raw(column)} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

/** Keyset paging, newest first: rows strictly after the cursor's (time, id). */
function after(cursor: string | undefined, timeColumn: string, idColumn: string, idKind: 'uuid' | 'bigint'): Cond | null {
  if (cursor === undefined) return null;
  const [time, id] = decodeCursor(cursor, 2);
  if (!SORT_TIME.test(time) || !(idKind === 'uuid' ? UUID : BIGINT).test(id)) throw badCursor();
  return sql`(${sql.raw(timeColumn)}, ${sql.raw(idColumn)}) < (${time}::timestamptz, ${id}::${sql.raw(idKind)})`;
}

interface Sorted {
  sort_time: string;
  sort_id: string;
}
const keyOf = (r: Sorted): string[] => [r.sort_time, r.sort_id];

interface AuditRow extends Sorted {
  id: string;
  entry_id: string;
  occurred_at: Date;
  received_at: Date;
  outcome: string;
  reason: string;
  detail: string | null;
  user_snapshot: unknown;
  card_snapshot: unknown;
  workstation_snapshot: unknown;
  target_os_username: string | null;
  data_version: string | null;
  matched_schedule_ids: string[] | null;
  has_card_uid: boolean;
}

const auditView = (r: AuditRow): AuditLogView => ({
  id: r.id,
  entry_id: r.entry_id,
  occurred_at: r.occurred_at,
  received_at: r.received_at,
  outcome: r.outcome,
  reason: r.reason,
  detail: r.detail,
  user: r.user_snapshot,
  card: r.card_snapshot,
  workstation: r.workstation_snapshot,
  target_os_username: r.target_os_username,
  data_version: r.data_version === null ? null : Number(r.data_version),
  matched_schedule_ids: r.matched_schedule_ids,
  has_card_uid: r.has_card_uid,
});

const AUDIT_COLUMNS = sql`
  a.id, a.entry_id, a.occurred_at, a.received_at, a.outcome, a.reason, a.detail, a.user_snapshot, a.card_snapshot,
  a.workstation_snapshot, a.target_os_username, a.data_version::text AS data_version, a.matched_schedule_ids,
  (a.card_uid_index IS NOT NULL) AS has_card_uid`;

/** What the workstations reported and what admins did, for the Dashboard. Read-only except resolving a reject. */
@Injectable()
export class HistoryService {
  constructor(
    @Inject(KYSELY) private readonly db: Db,
    private readonly vault: UidVault,
  ) {}

  /** FR-072. The UID itself is only in the detail view (NFR-SEC03). */
  async auditLogs(f: AuditFilter): Promise<Page<AuditLogView>> {
    const limit = f.limit ?? PAGE_LIMIT_DEFAULT;
    let cardIndex: string | undefined;
    if (f.cardUid !== undefined) {
      try {
        cardIndex = this.vault.index(normalizeUid(f.cardUid));
      } catch (err) {
        if (err instanceof InvalidUidError) throw new AppError('INVALID_UID', err.message);
        throw err;
      }
    }
    const conds = [
      f.userId === undefined ? null : sql`a.user_snapshot->>'id' = ${f.userId}`,
      eq('a.workstation_id', f.workstationId),
      f.zoneId === undefined ? null : sql`a.workstation_snapshot->'zone'->>'id' = ${f.zoneId}`,
      eq('a.outcome', f.outcome, 'text'),
      eq('a.reason', f.reason, 'text'),
      cardIndex === undefined ? null : sql`a.card_uid_index = ${cardIndex}`,
      ...range('a.occurred_at', f),
      after(f.cursor, 'a.occurred_at', 'a.id', 'uuid'),
    ];
    const rows = (
      await sql<AuditRow>`
        SELECT ${AUDIT_COLUMNS}, ${sortTime('a.occurred_at')} AS sort_time, a.id::text AS sort_id
        FROM audit_logs a WHERE ${where(conds)}
        ORDER BY a.occurred_at DESC, a.id DESC LIMIT ${limit + 1}
      `.execute(this.db)
    ).rows;
    return toPage(rows, limit, keyOf, auditView);
  }

  async auditLog(id: string): Promise<AuditLogDetail> {
    const row = (
      await sql<
        AuditRow & {
          reader_raw: string | null;
          card_uid_encrypted: Buffer | null;
          card_uid_iv: Buffer | null;
          card_uid_auth_tag: Buffer | null;
          encryption_key_id: string | null;
        }
      >`
        SELECT ${AUDIT_COLUMNS}, '' AS sort_time, '' AS sort_id,
               a.reader_raw, a.card_uid_encrypted, a.card_uid_iv, a.card_uid_auth_tag, a.encryption_key_id
        FROM audit_logs a WHERE a.id = ${id}::uuid
      `.execute(this.db)
    ).rows[0];
    if (!row) throw new AppError('NOT_FOUND', 'Audit record not found');
    const cardUid =
      row.card_uid_encrypted && row.card_uid_iv && row.card_uid_auth_tag && row.encryption_key_id
        ? this.vault.decrypt({ ciphertext: row.card_uid_encrypted, iv: row.card_uid_iv, authTag: row.card_uid_auth_tag, keyId: row.encryption_key_id })
        : null;
    return { ...auditView(row), card_uid: cardUid, reader_raw: row.reader_raw };
  }

  async sessions(f: SessionFilter): Promise<Page<unknown>> {
    const limit = f.limit ?? PAGE_LIMIT_DEFAULT;
    const conds = [
      eq('s.workstation_id', f.workstationId),
      eq('s.user_id', f.userId),
      eq('s.status', f.status, 'text'),
      ...range('s.started_at', f),
      after(f.cursor, 's.started_at', 's.id', 'uuid'),
    ];
    const rows = (
      await sql<Sorted & Record<string, unknown>>`
        SELECT s.id, s.decision_id, s.card_id, s.os_username, s.boot_id, s.decided_at, s.started_at, s.expires_at,
               s.status, s.ended_at, s.end_reason, s.end_source,
               json_build_object('id', u.id, 'external_id', u.external_id, 'full_name', u.full_name) AS user,
               json_build_object('id', w.id, 'mqtt_identity', w.mqtt_identity) AS workstation,
               ${sortTime('s.started_at')} AS sort_time, s.id::text AS sort_id
        FROM sessions s JOIN users u ON u.id = s.user_id JOIN workstations w ON w.id = s.workstation_id
        WHERE ${where(conds)}
        ORDER BY s.started_at DESC, s.id DESC LIMIT ${limit + 1}
      `.execute(this.db)
    ).rows;
    return toPage(rows, limit, keyOf, ({ sort_time: _t, sort_id: _i, ...view }) => view);
  }

  /** D-015: records the server kept verbatim instead of applying; an admin looks at them and marks them seen. */
  async ingestRejects(f: RejectFilter): Promise<Page<unknown>> {
    const limit = f.limit ?? PAGE_LIMIT_DEFAULT;
    const resolved = f.resolved ?? 'false';
    const conds = [
      eq('r.workstation_id', f.workstationId),
      resolved === 'all' ? null : resolved === 'true' ? sql`r.resolved_at IS NOT NULL` : sql`r.resolved_at IS NULL`,
      after(f.cursor, 'r.received_at', 'r.id', 'bigint'),
    ];
    const rows = (
      await sql<Sorted & Record<string, unknown>>`
        SELECT r.id::text AS id, r.entry_id, r.outbox_seq::text AS outbox_seq, r.raw_record, r.error, r.received_at,
               r.resolved_at, r.resolved_by, r.note,
               json_build_object('id', w.id, 'mqtt_identity', w.mqtt_identity) AS workstation,
               ${sortTime('r.received_at')} AS sort_time, r.id::text AS sort_id
        FROM ingest_rejects r JOIN workstations w ON w.id = r.workstation_id
        WHERE ${where(conds)}
        ORDER BY r.received_at DESC, r.id DESC LIMIT ${limit + 1}
      `.execute(this.db)
    ).rows;
    return toPage(rows, limit, keyOf, ({ sort_time: _t, sort_id: _i, outbox_seq, ...view }) => ({
      ...view,
      outbox_seq: outbox_seq === null ? null : Number(outbox_seq),
    }));
  }

  /** Marks a reject as seen. Repeating it changes nothing; the first resolver and note stay. */
  async resolveReject(id: string, note: string | undefined, actorId: string): Promise<unknown> {
    if (!BIGINT.test(id)) throw new AppError('NOT_FOUND', 'Ingest reject not found');
    return this.db.transaction().execute(async (trx) => {
      const updated = (
        await sql<{ id: string }>`
          UPDATE ingest_rejects SET resolved_at = now(), resolved_by = ${actorId}::uuid, note = ${note?.trim() || null}
          WHERE id = ${id}::bigint AND resolved_at IS NULL
          RETURNING id::text AS id
        `.execute(trx)
      ).rows[0];
      if (updated) {
        await recordAdminAction(trx, { adminId: actorId, action: 'ingest_reject.resolve', entityType: 'ingest_reject', after: { id, note: note?.trim() || null } });
      }
      const row = (
        await sql<Record<string, unknown>>`
          SELECT id::text AS id, entry_id, error, received_at, resolved_at, resolved_by, note FROM ingest_rejects WHERE id = ${id}::bigint
        `.execute(trx)
      ).rows[0];
      if (!row) throw new AppError('NOT_FOUND', 'Ingest reject not found');
      return row;
    });
  }

  async alerts(f: AlertFilter): Promise<Page<unknown>> {
    const limit = f.limit ?? PAGE_LIMIT_DEFAULT;
    const conds = [eq('a.workstation_id', f.workstationId), ...range('a.occurred_at', { from: f.from }), after(f.cursor, 'a.occurred_at', 'a.id', 'uuid')];
    const rows = (
      await sql<Sorted & Record<string, unknown>>`
        SELECT a.id, a.entry_id, a.kind, a.detail, a.occurred_at, a.received_at,
               json_build_object('id', w.id, 'mqtt_identity', w.mqtt_identity) AS workstation,
               ${sortTime('a.occurred_at')} AS sort_time, a.id::text AS sort_id
        FROM workstation_alerts a JOIN workstations w ON w.id = a.workstation_id
        WHERE ${where(conds)}
        ORDER BY a.occurred_at DESC, a.id DESC LIMIT ${limit + 1}
      `.execute(this.db)
    ).rows;
    return toPage(rows, limit, keyOf, ({ sort_time: _t, sort_id: _i, ...view }) => view);
  }

  /** D-020: every admin change, newest first. */
  async adminAuditLogs(f: AdminAuditFilter): Promise<Page<unknown>> {
    const limit = f.limit ?? PAGE_LIMIT_DEFAULT;
    const conds = [
      eq('l.admin_id', f.adminId),
      eq('l.entity_type', f.entityType, 'text'),
      eq('l.entity_id', f.entityId),
      ...range('l.occurred_at', f),
      after(f.cursor, 'l.occurred_at', 'l.id', 'bigint'),
    ];
    const rows = (
      await sql<Sorted & Record<string, unknown>>`
        SELECT l.id::text AS id, l.action, l.entity_type, l.entity_id, l.before, l.after, l.occurred_at,
               json_build_object('id', ad.id, 'username', ad.username, 'display_name', ad.display_name) AS admin,
               ${sortTime('l.occurred_at')} AS sort_time, l.id::text AS sort_id
        FROM admin_audit_logs l JOIN admin_accounts ad ON ad.id = l.admin_id
        WHERE ${where(conds)}
        ORDER BY l.occurred_at DESC, l.id DESC LIMIT ${limit + 1}
      `.execute(this.db)
    ).rows;
    return toPage(rows, limit, keyOf, ({ sort_time: _t, sort_id: _i, ...view }) => view);
  }
}
