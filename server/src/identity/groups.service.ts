import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { Db, KYSELY } from '../infra/database/database.module';
import { isForeignKeyViolation, isUniqueViolation } from '../infra/database/pg-errors';
import { recordAdminAction } from '../shared/admin-audit';
import { AppError } from '../shared/http/app-error';
import { emitEvent } from '../shared/outbox';
import { UserView } from './users.service';

export interface GroupView {
  id: string;
  name: string;
  description: string | null;
  member_count: number;
  created_at: Date;
  updated_at: Date;
}

export interface GroupChanges {
  name?: string;
  description?: string | null;
}

const notFound = (): AppError => new AppError('NOT_FOUND', 'Group not found');
const duplicate = (): AppError => new AppError('DUPLICATE', 'Group name already exists', [{ field: 'name', constraints: ['name already exists'] }]);
const cleanDescription = (d: string | null | undefined): string | null => d?.trim() || null;

@Injectable()
export class GroupsService {
  constructor(@Inject(KYSELY) private readonly db: Db) {}

  private views(db: Db) {
    return db
      .selectFrom('groups')
      .leftJoin('group_members', 'group_members.group_id', 'groups.id')
      .select([
        'groups.id',
        'groups.name',
        'groups.description',
        'groups.created_at',
        'groups.updated_at',
        sql<number>`count(group_members.user_id)::int`.as('member_count'),
      ])
      .groupBy('groups.id');
  }

  private async view(db: Db, id: string): Promise<GroupView> {
    const group = await this.views(db).where('groups.id', '=', id).executeTakeFirst();
    if (!group) throw notFound();
    return group;
  }

  /** Small list (api.md): all groups, no paging, ordered by name case-insensitive. */
  list(): Promise<GroupView[]> {
    return this.views(this.db).orderBy(sql`lower(groups.name)`).execute();
  }

  async create(name: string, description: string | null | undefined, actorId: string): Promise<GroupView> {
    try {
      return await this.db.transaction().execute(async (trx) => {
        const group = await trx
          .insertInto('groups')
          .values({ name: name.trim(), description: cleanDescription(description) })
          .returning(['id', 'name', 'description'])
          .executeTakeFirstOrThrow();
        await recordAdminAction(trx, {
          adminId: actorId,
          action: 'group.create',
          entityType: 'group',
          entityId: group.id,
          after: { name: group.name, description: group.description },
        });
        return this.view(trx, group.id);
      });
    } catch (err) {
      if (isUniqueViolation(err, 'uq_groups_name_ci')) throw duplicate();
      throw err;
    }
  }

  async update(id: string, changes: GroupChanges, actorId: string): Promise<GroupView> {
    try {
      return await this.db.transaction().execute(async (trx) => {
        const current = await trx.selectFrom('groups').select(['name', 'description']).where('id', '=', id).forUpdate().executeTakeFirst();
        if (!current) throw notFound();
        const set: { name?: string; description?: string | null } = {};
        const before: { name?: string; description?: string | null } = {};
        const name = changes.name?.trim();
        if (name !== undefined && name !== current.name) {
          set.name = name;
          before.name = current.name;
        }
        if (changes.description !== undefined) {
          const description = cleanDescription(changes.description);
          if (description !== current.description) {
            set.description = description;
            before.description = current.description;
          }
        }
        if (Object.keys(set).length > 0) {
          await trx.updateTable('groups').set({ ...set, updated_at: new Date() }).where('id', '=', id).execute();
          await recordAdminAction(trx, { adminId: actorId, action: 'group.update', entityType: 'group', entityId: id, before, after: set });
        }
        return this.view(trx, id);
      });
    } catch (err) {
      if (isUniqueViolation(err, 'uq_groups_name_ci')) throw duplicate();
      throw err;
    }
  }

  /** BR-017: refused while a schedule targets the group as subject; memberships go with the group (FK cascade). */
  async remove(id: string, actorId: string): Promise<void> {
    try {
      await this.db.transaction().execute(async (trx) => {
        const current = await trx.selectFrom('groups').select(['name', 'description']).where('id', '=', id).forUpdate().executeTakeFirst();
        if (!current) throw notFound();
        const schedules = await trx
          .selectFrom('schedules')
          .select(['id', 'name'])
          .where('subject_group_id', '=', id)
          .orderBy('name')
          .execute();
        if (schedules.length > 0) throw referenced(schedules.map((s) => ({ schedule_id: s.id, name: s.name })));
        const members = await trx.selectFrom('group_members').select('user_id').where('group_id', '=', id).execute();
        await trx.deleteFrom('groups').where('id', '=', id).execute();
        await recordAdminAction(trx, {
          adminId: actorId,
          action: 'group.delete',
          entityType: 'group',
          entityId: id,
          before: { ...current, member_count: members.length },
        });
      });
    } catch (err) {
      // A schedule created concurrently after the check above still hits ON DELETE RESTRICT.
      if (isForeignKeyViolation(err)) throw referenced([]);
      throw err;
    }
  }

  async members(id: string): Promise<UserView[]> {
    await this.view(this.db, id);
    return this.db
      .selectFrom('group_members')
      .innerJoin('users', 'users.id', 'group_members.user_id')
      .selectAll('users')
      .where('group_members.group_id', '=', id)
      .orderBy('users.external_id')
      .execute();
  }

  /** Adds members in bulk; already-members are skipped. Unknown user ids fail the whole call. */
  async addMembers(id: string, userIds: string[], actorId: string): Promise<{ added: string[] }> {
    const ids = [...new Set(userIds)];
    return this.db.transaction().execute(async (trx) => {
      const group = await trx.selectFrom('groups').select('id').where('id', '=', id).forUpdate().executeTakeFirst();
      if (!group) throw notFound();
      const found = new Set((await trx.selectFrom('users').select('id').where('id', 'in', ids).execute()).map((u) => u.id));
      const missing = ids.filter((u) => !found.has(u));
      if (missing.length > 0) {
        throw new AppError(
          'VALIDATION_ERROR',
          'Some users do not exist',
          missing.map((value) => ({ field: 'user_ids', constraints: ['user not found'], value })),
        );
      }
      const inserted = await trx
        .insertInto('group_members')
        .values(ids.map((user_id) => ({ group_id: id, user_id })))
        .onConflict((oc) => oc.columns(['group_id', 'user_id']).doNothing())
        .returning('user_id')
        .execute();
      const added = inserted.map((r) => r.user_id).sort();
      if (added.length > 0) {
        await recordAdminAction(trx, { adminId: actorId, action: 'group.members_add', entityType: 'group', entityId: id, after: { user_ids: added } });
        await emitEvent(trx, { aggregateType: 'group', aggregateId: id, eventType: 'GroupMembershipChanged', payload: { added, removed: [] } });
      }
      return { added };
    });
  }

  /** Removing a user who is not a member is a no-op (204, no audit, no event). */
  async removeMember(id: string, userId: string, actorId: string): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      const group = await trx.selectFrom('groups').select('id').where('id', '=', id).forUpdate().executeTakeFirst();
      if (!group) throw notFound();
      const removed = await trx
        .deleteFrom('group_members')
        .where('group_id', '=', id)
        .where('user_id', '=', userId)
        .returning('user_id')
        .execute();
      if (removed.length === 0) return;
      await recordAdminAction(trx, { adminId: actorId, action: 'group.members_remove', entityType: 'group', entityId: id, before: { user_ids: [userId] } });
      await emitEvent(trx, { aggregateType: 'group', aggregateId: id, eventType: 'GroupMembershipChanged', payload: { added: [], removed: [userId] } });
    });
  }
}

function referenced(details: { schedule_id: string; name: string }[]): AppError {
  return new AppError('REFERENCED_BY_SCHEDULE', 'The group is used by schedules', details);
}
