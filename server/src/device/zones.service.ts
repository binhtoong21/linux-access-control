import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { Db, KYSELY } from '../infra/database/database.module';
import { isForeignKeyViolation, isUniqueViolation } from '../infra/database/pg-errors';
import { recordAdminAction } from '../shared/admin-audit';
import { AppError } from '../shared/http/app-error';
import { emitEvent } from '../shared/outbox';

export interface ZoneView {
  id: string;
  name: string;
  location: string;
  description: string | null;
  workstation_count: number;
  created_at: Date;
  updated_at: Date;
}

export interface ZoneChanges {
  name?: string;
  location?: string;
  description?: string | null;
}

type ZoneFields = { name?: string; location?: string; description?: string | null };

const notFound = (): AppError => new AppError('NOT_FOUND', 'Zone not found');
const duplicate = (): AppError => new AppError('DUPLICATE', 'Zone name already exists', [{ field: 'name', constraints: ['name already exists'] }]);
const cleanDescription = (d: string | null | undefined): string | null => d?.trim() || null;

@Injectable()
export class ZonesService {
  constructor(@Inject(KYSELY) private readonly db: Db) {}

  private views(db: Db) {
    return db
      .selectFrom('zones')
      .leftJoin('workstations', 'workstations.zone_id', 'zones.id')
      .select([
        'zones.id',
        'zones.name',
        'zones.location',
        'zones.description',
        'zones.created_at',
        'zones.updated_at',
        sql<number>`count(workstations.id)::int`.as('workstation_count'),
      ])
      .groupBy('zones.id');
  }

  private async view(db: Db, id: string): Promise<ZoneView> {
    const zone = await this.views(db).where('zones.id', '=', id).executeTakeFirst();
    if (!zone) throw notFound();
    return zone;
  }

  /** Small list (api.md): all zones, no paging, ordered by name case-insensitive. */
  list(): Promise<ZoneView[]> {
    return this.views(this.db).orderBy(sql`lower(zones.name)`).execute();
  }

  async create(name: string, location: string, description: string | null | undefined, actorId: string): Promise<ZoneView> {
    try {
      return await this.db.transaction().execute(async (trx) => {
        const zone = await trx
          .insertInto('zones')
          .values({ name: name.trim(), location: location.trim(), description: cleanDescription(description) })
          .returning(['id', 'name', 'location', 'description'])
          .executeTakeFirstOrThrow();
        await recordAdminAction(trx, {
          adminId: actorId,
          action: 'zone.create',
          entityType: 'zone',
          entityId: zone.id,
          after: { name: zone.name, location: zone.location, description: zone.description },
        });
        return this.view(trx, zone.id);
      });
    } catch (err) {
      if (isUniqueViolation(err, 'uq_zones_name_ci')) throw duplicate();
      throw err;
    }
  }

  async update(id: string, changes: ZoneChanges, actorId: string): Promise<ZoneView> {
    try {
      return await this.db.transaction().execute(async (trx) => {
        const current = await trx.selectFrom('zones').select(['name', 'location', 'description']).where('id', '=', id).forUpdate().executeTakeFirst();
        if (!current) throw notFound();
        const set: ZoneFields = {};
        const before: ZoneFields = {};
        const name = changes.name?.trim();
        if (name !== undefined && name !== current.name) {
          set.name = name;
          before.name = current.name;
        }
        const location = changes.location?.trim();
        if (location !== undefined && location !== current.location) {
          set.location = location;
          before.location = current.location;
        }
        if (changes.description !== undefined) {
          const description = cleanDescription(changes.description);
          if (description !== current.description) {
            set.description = description;
            before.description = current.description;
          }
        }
        if (Object.keys(set).length > 0) {
          await trx.updateTable('zones').set({ ...set, updated_at: new Date() }).where('id', '=', id).execute();
          await recordAdminAction(trx, { adminId: actorId, action: 'zone.update', entityType: 'zone', entityId: id, before, after: set });
        }
        return this.view(trx, id);
      });
    } catch (err) {
      if (isUniqueViolation(err, 'uq_zones_name_ci')) throw duplicate();
      throw err;
    }
  }

  /**
   * BR-017: refused while a schedule targets the zone. BR-015: workstations stay and lose their zone (FK SET NULL);
   * ZoneDeleted carries their ids because the link is gone once the event is read.
   */
  async remove(id: string, actorId: string): Promise<void> {
    try {
      await this.db.transaction().execute(async (trx) => {
        const current = await trx.selectFrom('zones').select(['name', 'location', 'description']).where('id', '=', id).forUpdate().executeTakeFirst();
        if (!current) throw notFound();
        const schedules = await trx
          .selectFrom('schedules')
          .select(['id', 'name'])
          .where('target_zone_id', '=', id)
          .orderBy('name')
          .execute();
        if (schedules.length > 0) throw referenced(schedules.map((s) => ({ schedule_id: s.id, name: s.name })));
        const workstations = await trx.selectFrom('workstations').select('id').where('zone_id', '=', id).orderBy('id').execute();
        const workstationIds = workstations.map((w) => w.id);
        await trx.deleteFrom('zones').where('id', '=', id).execute();
        await recordAdminAction(trx, {
          adminId: actorId,
          action: 'zone.delete',
          entityType: 'zone',
          entityId: id,
          before: { ...current, workstation_ids: workstationIds },
        });
        if (workstationIds.length > 0) {
          await emitEvent(trx, { aggregateType: 'zone', aggregateId: id, eventType: 'ZoneDeleted', payload: { workstation_ids: workstationIds } });
        }
      });
    } catch (err) {
      // A schedule created concurrently after the check above still hits ON DELETE RESTRICT.
      if (isForeignKeyViolation(err)) throw referenced([]);
      throw err;
    }
  }
}

function referenced(details: { schedule_id: string; name: string }[]): AppError {
  return new AppError('REFERENCED_BY_SCHEDULE', 'The zone is used by schedules', details);
}
