import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { Db, KYSELY } from '../infra/database/database.module';
import { isForeignKeyViolation } from '../infra/database/pg-errors';
import { ScheduleStatus } from '../infra/database/schema';
import { recordAdminAction } from '../shared/admin-audit';
import { AppError, FieldError } from '../shared/http/app-error';
import { emitEvent } from '../shared/outbox';

export const DAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'] as const;
export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
// 00:00 … 23:59, plus 24:00 as an end of day (D-011).
export const TIME_PATTERN = /^(([01]\d|2[0-3]):[0-5]\d|24:00)$/;
export const OS_USERNAME_PATTERN = /^[a-z_][a-z0-9_-]{0,31}$/;

export interface ScheduleInput {
  name: string;
  subject: { type: 'user' | 'group'; id: string };
  target: { type: 'workstation' | 'zone'; id: string };
  valid_from: string;
  valid_to?: string | null;
  days_of_week: string[];
  start_time: string;
  end_time: string;
  target_os_username?: string | null;
}

export interface ScheduleView {
  id: string;
  name: string;
  subject: { type: 'user' | 'group'; id: string; name: string; external_id?: string };
  target: { type: 'workstation' | 'zone'; id: string; name: string };
  valid_from: string;
  valid_to: string | null;
  days_of_week: string[];
  start_time: string;
  end_time: string;
  target_os_username: string | null;
  status: ScheduleStatus;
  created_at: Date;
  updated_at: Date;
}

export interface ScheduleFilter {
  workstationId?: string;
  zoneId?: string;
  groupId?: string;
  userId?: string;
  status?: ScheduleStatus;
}

// The stored columns an admin can change (everything but id, status and timestamps).
type Fields = {
  name: string;
  subject_type: 'user' | 'group';
  subject_user_id: string | null;
  subject_group_id: string | null;
  target_type: 'workstation' | 'zone';
  target_workstation_id: string | null;
  target_zone_id: string | null;
  valid_from: string;
  valid_to: string | null;
  days_of_week: string[];
  start_minute: number;
  end_minute: number;
  target_os_username: string | null;
};

interface ScheduleRow {
  id: string;
  name: string;
  subject_type: 'user' | 'group';
  subject_user_id: string | null;
  subject_group_id: string | null;
  target_type: 'workstation' | 'zone';
  target_workstation_id: string | null;
  target_zone_id: string | null;
  valid_from: string;
  valid_to: string | null;
  days_of_week: string[];
  start_minute: number;
  end_minute: number;
  target_os_username: string | null;
  status: ScheduleStatus;
  created_at: Date;
  updated_at: Date;
  user_external_id: string | null;
  user_full_name: string | null;
  group_name: string | null;
  workstation_identity: string | null;
  zone_name: string | null;
}

const notFound = (): AppError => new AppError('NOT_FOUND', 'Schedule not found');
const invalid = (details: FieldError[]): AppError => new AppError('VALIDATION_ERROR', 'Schedule is not valid', details);

const toMinute = (time: string): number => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
const toTime = (minute: number): string => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;

function toFields(input: ScheduleInput): Fields {
  return {
    name: input.name.trim(),
    subject_type: input.subject.type,
    subject_user_id: input.subject.type === 'user' ? input.subject.id : null,
    subject_group_id: input.subject.type === 'group' ? input.subject.id : null,
    target_type: input.target.type,
    target_workstation_id: input.target.type === 'workstation' ? input.target.id : null,
    target_zone_id: input.target.type === 'zone' ? input.target.id : null,
    valid_from: input.valid_from,
    valid_to: input.valid_to ?? null,
    // Stored without duplicates, Monday first.
    days_of_week: DAYS.filter((day) => input.days_of_week.includes(day)),
    start_minute: toMinute(input.start_time),
    end_minute: toMinute(input.end_time),
    target_os_username: input.target_os_username ?? null,
  };
}

function toView(r: ScheduleRow): ScheduleView {
  return {
    id: r.id,
    name: r.name,
    subject:
      r.subject_type === 'user'
        ? { type: 'user', id: r.subject_user_id as string, name: r.user_full_name ?? '', external_id: r.user_external_id ?? '' }
        : { type: 'group', id: r.subject_group_id as string, name: r.group_name ?? '' },
    target:
      r.target_type === 'workstation'
        ? { type: 'workstation', id: r.target_workstation_id as string, name: r.workstation_identity ?? '' }
        : { type: 'zone', id: r.target_zone_id as string, name: r.zone_name ?? '' },
    valid_from: r.valid_from,
    valid_to: r.valid_to,
    days_of_week: r.days_of_week,
    start_time: toTime(r.start_minute),
    end_time: toTime(r.end_minute),
    target_os_username: r.target_os_username,
    status: r.status,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

function toInput(v: ScheduleView): ScheduleInput {
  return {
    name: v.name,
    subject: { type: v.subject.type, id: v.subject.id },
    target: { type: v.target.type, id: v.target.id },
    valid_from: v.valid_from,
    valid_to: v.valid_to,
    days_of_week: v.days_of_week,
    start_time: v.start_time,
    end_time: v.end_time,
    target_os_username: v.target_os_username,
  };
}

// What the Distribution worker needs to find the affected workstations once the row has changed or is gone.
const targetOf = (f: Fields) => ({ target_type: f.target_type, target_workstation_id: f.target_workstation_id, target_zone_id: f.target_zone_id });

@Injectable()
export class SchedulesService {
  constructor(@Inject(KYSELY) private readonly db: Db) {}

  private rows(db: Db) {
    return db
      .selectFrom('schedules as s')
      .leftJoin('users as u', 'u.id', 's.subject_user_id')
      .leftJoin('groups as g', 'g.id', 's.subject_group_id')
      .leftJoin('workstations as w', 'w.id', 's.target_workstation_id')
      .leftJoin('zones as z', 'z.id', 's.target_zone_id')
      .select([
        's.id',
        's.name',
        's.subject_type',
        's.subject_user_id',
        's.subject_group_id',
        's.target_type',
        's.target_workstation_id',
        's.target_zone_id',
        sql<string>`to_char(s.valid_from, 'YYYY-MM-DD')`.as('valid_from'),
        sql<string | null>`to_char(s.valid_to, 'YYYY-MM-DD')`.as('valid_to'),
        's.days_of_week',
        's.start_minute',
        's.end_minute',
        's.target_os_username',
        's.status',
        's.created_at',
        's.updated_at',
        'u.external_id as user_external_id',
        'u.full_name as user_full_name',
        'g.name as group_name',
        'w.mqtt_identity as workstation_identity',
        'z.name as zone_name',
      ]);
  }

  private async view(db: Db, id: string): Promise<ScheduleView> {
    const row: ScheduleRow | undefined = await this.rows(db).where('s.id', '=', id).executeTakeFirst();
    if (!row) throw notFound();
    return toView(row);
  }

  /** Locks the schedule row for the rest of the transaction and returns its current view. */
  private async locked(trx: Db, id: string): Promise<ScheduleView> {
    const row = await trx.selectFrom('schedules').select('id').where('id', '=', id).forUpdate().executeTakeFirst();
    if (!row) throw notFound();
    return this.view(trx, id);
  }

  /** VR-003, VR-004 and existence of subject and target (VR-005); shape rules are checked by the DTOs. */
  private async check(db: Db, f: Fields): Promise<void> {
    const errors: FieldError[] = [];
    if (f.start_minute >= f.end_minute) errors.push({ field: 'end_time', constraints: ['end_time must be after start_time'] });
    if (f.valid_to !== null && f.valid_to < f.valid_from) errors.push({ field: 'valid_to', constraints: ['valid_to must not be before valid_from'] });
    const subject =
      f.subject_type === 'user'
        ? await db.selectFrom('users').select('id').where('id', '=', f.subject_user_id as string).executeTakeFirst()
        : await db.selectFrom('groups').select('id').where('id', '=', f.subject_group_id as string).executeTakeFirst();
    if (!subject) errors.push({ field: 'subject.id', constraints: [`${f.subject_type} not found`] });
    const target =
      f.target_type === 'workstation'
        ? await db.selectFrom('workstations').select('id').where('id', '=', f.target_workstation_id as string).executeTakeFirst()
        : await db.selectFrom('zones').select('id').where('id', '=', f.target_zone_id as string).executeTakeFirst();
    if (!target) errors.push({ field: 'target.id', constraints: [`${f.target_type} not found`] });
    if (errors.length > 0) throw invalid(errors);
  }

  /** FR-022. `workstationId` also matches schedules on the workstation's zone; `userId` also matches schedules on the user's groups. */
  async list(filter: ScheduleFilter): Promise<ScheduleView[]> {
    let query = this.rows(this.db);
    if (filter.status) query = query.where('s.status', '=', filter.status);
    if (filter.zoneId) query = query.where('s.target_zone_id', '=', filter.zoneId);
    if (filter.groupId) query = query.where('s.subject_group_id', '=', filter.groupId);
    if (filter.workstationId) {
      const id = filter.workstationId;
      query = query.where(
        sql<boolean>`(s.target_workstation_id = ${id}::uuid or s.target_zone_id = (select zone_id from workstations where id = ${id}::uuid))`,
      );
    }
    if (filter.userId) {
      const id = filter.userId;
      query = query.where(
        sql<boolean>`(s.subject_user_id = ${id}::uuid or s.subject_group_id in (select group_id from group_members where user_id = ${id}::uuid))`,
      );
    }
    const rows: ScheduleRow[] = await query.orderBy(sql`lower(s.name)`).orderBy('s.id').execute();
    return rows.map(toView);
  }

  get(id: string): Promise<ScheduleView> {
    return this.view(this.db, id);
  }

  async create(input: ScheduleInput, actorId: string): Promise<ScheduleView> {
    const fields = toFields(input);
    try {
      return await this.db.transaction().execute(async (trx) => {
        await this.check(trx, fields);
        const row = await trx.insertInto('schedules').values(fields).returning('id').executeTakeFirstOrThrow();
        await recordAdminAction(trx, { adminId: actorId, action: 'schedule.create', entityType: 'schedule', entityId: row.id, after: fields });
        await emitEvent(trx, { aggregateType: 'schedule', aggregateId: row.id, eventType: 'ScheduleCreated', payload: { after: targetOf(fields) } });
        return this.view(trx, row.id);
      });
    } catch (err) {
      throw vanished(err);
    }
  }

  /** Absent keys keep their value; `valid_to: null` and `target_os_username: null` clear the field. */
  async update(id: string, patch: Partial<ScheduleInput>, actorId: string): Promise<ScheduleView> {
    try {
      return await this.db.transaction().execute(async (trx) => {
        const current = await this.locked(trx, id);
        const given = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)) as Partial<ScheduleInput>;
        const before = toFields(toInput(current));
        const after = toFields({ ...toInput(current), ...given });
        const changed = (Object.keys(after) as (keyof Fields)[]).filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
        if (changed.length === 0) return current;
        await this.check(trx, after);
        const pick = (f: Fields): Partial<Fields> => Object.fromEntries(changed.map((key) => [key, f[key]])) as Partial<Fields>;
        await trx
          .updateTable('schedules')
          .set({ ...pick(after), updated_at: new Date() })
          .where('id', '=', id)
          .execute();
        await recordAdminAction(trx, { adminId: actorId, action: 'schedule.update', entityType: 'schedule', entityId: id, before: pick(before), after: pick(after) });
        await emitEvent(trx, {
          aggregateType: 'schedule',
          aggregateId: id,
          eventType: 'ScheduleUpdated',
          payload: { before: pick(before), after: pick(after) },
        });
        return this.view(trx, id);
      });
    } catch (err) {
      throw vanished(err);
    }
  }

  /** FR-021: a disabled schedule is ignored at evaluation. Setting the status it already has is a no-op. */
  async setStatus(id: string, status: ScheduleStatus, actorId: string): Promise<ScheduleView> {
    return this.db.transaction().execute(async (trx) => {
      const current = await this.locked(trx, id);
      if (current.status === status) return current;
      await trx.updateTable('schedules').set({ status, updated_at: new Date() }).where('id', '=', id).execute();
      const enabled = status === 'enabled';
      await recordAdminAction(trx, { adminId: actorId, action: enabled ? 'schedule.enable' : 'schedule.disable', entityType: 'schedule', entityId: id });
      await emitEvent(trx, { aggregateType: 'schedule', aggregateId: id, eventType: enabled ? 'ScheduleEnabled' : 'ScheduleDisabled', payload: {} });
      return this.view(trx, id);
    });
  }

  async remove(id: string, actorId: string): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      const current = await this.locked(trx, id);
      const fields = toFields(toInput(current));
      await trx.deleteFrom('schedules').where('id', '=', id).execute();
      await recordAdminAction(trx, {
        adminId: actorId,
        action: 'schedule.delete',
        entityType: 'schedule',
        entityId: id,
        before: { ...fields, status: current.status },
      });
      await emitEvent(trx, { aggregateType: 'schedule', aggregateId: id, eventType: 'ScheduleDeleted', payload: { before: targetOf(fields) } });
    });
  }
}

// A subject or target deleted between the existence check and the write still hits the foreign key.
function vanished(err: unknown): unknown {
  return isForeignKeyViolation(err) ? invalid([{ field: 'subject.id', constraints: ['subject or target no longer exists'] }]) : err;
}
