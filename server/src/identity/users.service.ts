import { Inject, Injectable } from '@nestjs/common';
import { Db, KYSELY } from '../infra/database/database.module';
import { isUniqueViolation } from '../infra/database/pg-errors';
import { CardStatus, UserStatus } from '../infra/database/schema';
import { recordAdminAction } from '../shared/admin-audit';
import { AppError } from '../shared/http/app-error';
import { decodeCursor, Page, PAGE_LIMIT_DEFAULT, toPage } from '../shared/http/pagination';
import { emitEvent } from '../shared/outbox';

export const EXTERNAL_ID_PATTERN = /^[A-Za-z0-9._-]{1,32}$/; // VR-011

export interface UserView {
  id: string;
  external_id: string;
  full_name: string;
  email: string | null;
  status: UserStatus;
  created_at: Date;
  updated_at: Date;
}

export const USER_VIEW_COLUMNS = ['id', 'external_id', 'full_name', 'email', 'status', 'created_at', 'updated_at'] as const;

// Cards never carry the UID here (NFR-SEC03); only GET /cards/{id} decrypts it.
export interface UserDetail extends UserView {
  cards: { id: string; status: CardStatus; uid_length: number; created_at: Date }[];
  groups: { id: string; name: string }[];
}

export interface UserFilter {
  q?: string;
  status?: UserStatus;
  groupId?: string;
  limit?: number;
  cursor?: string;
}

export interface NewUser {
  externalId: string;
  fullName: string;
  email?: string | null;
}

export interface UserChanges {
  fullName?: string;
  email?: string | null;
}

const notFound = (): AppError => new AppError('NOT_FOUND', 'User not found');
const likePattern = (q: string): string => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
const auditView = (u: UserView) => ({ external_id: u.external_id, full_name: u.full_name, email: u.email, status: u.status });

@Injectable()
export class UsersService {
  constructor(@Inject(KYSELY) private readonly db: Db) {}

  /** Ordered by external_id; `q` matches external_id or full_name, case-insensitive, LIKE wildcards escaped. */
  async list(f: UserFilter): Promise<Page<UserView>> {
    const limit = f.limit ?? PAGE_LIMIT_DEFAULT;
    let query = this.db.selectFrom('users').select(USER_VIEW_COLUMNS).orderBy('external_id').limit(limit + 1);
    const q = f.q?.trim();
    if (q) {
      const pattern = likePattern(q);
      query = query.where((eb) => eb.or([eb('external_id', 'ilike', pattern), eb('full_name', 'ilike', pattern)]));
    }
    if (f.status) query = query.where('status', '=', f.status);
    const groupId = f.groupId;
    if (groupId) {
      query = query.where((eb) =>
        eb.exists(
          eb
            .selectFrom('group_members')
            .select('group_members.user_id')
            .whereRef('group_members.user_id', '=', 'users.id')
            .where('group_members.group_id', '=', groupId),
        ),
      );
    }
    if (f.cursor) {
      const [after] = decodeCursor(f.cursor, 1);
      query = query.where('external_id', '>', after);
    }
    return toPage(await query.execute(), limit, (u) => [u.external_id], (u) => u);
  }

  async get(id: string): Promise<UserDetail> {
    const user = await this.db.selectFrom('users').select(USER_VIEW_COLUMNS).where('id', '=', id).executeTakeFirst();
    if (!user) throw notFound();
    const cards = await this.db
      .selectFrom('cards')
      .select(['id', 'status', 'uid_length', 'created_at'])
      .where('owner_id', '=', id)
      .orderBy('created_at')
      .execute();
    const groups = await this.db
      .selectFrom('group_members')
      .innerJoin('groups', 'groups.id', 'group_members.group_id')
      .select(['groups.id', 'groups.name'])
      .where('group_members.user_id', '=', id)
      .orderBy('groups.name')
      .execute();
    return { ...user, cards, groups };
  }

  async create(input: NewUser, actorId: string): Promise<UserView> {
    try {
      return await this.db.transaction().execute(async (trx) => {
        const user = await trx
          .insertInto('users')
          .values({ external_id: input.externalId, full_name: input.fullName.trim(), email: input.email ?? null })
          .returning(USER_VIEW_COLUMNS)
          .executeTakeFirstOrThrow();
        await recordAdminAction(trx, { adminId: actorId, action: 'user.create', entityType: 'user', entityId: user.id, after: auditView(user) });
        return user;
      });
    } catch (err) {
      if (isUniqueViolation(err, 'uq_users_external_id')) {
        throw new AppError('DUPLICATE', 'external_id already exists', [{ field: 'external_id', constraints: ['external_id already exists'] }]);
      }
      throw err;
    }
  }

  /** Only changed fields are written; a request that changes nothing returns the user without audit or event. */
  async update(id: string, changes: UserChanges, actorId: string): Promise<UserView> {
    return this.db.transaction().execute(async (trx) => {
      const current = await trx.selectFrom('users').select(USER_VIEW_COLUMNS).where('id', '=', id).forUpdate().executeTakeFirst();
      if (!current) throw notFound();
      const set: { full_name?: string; email?: string | null } = {};
      const before: { full_name?: string; email?: string | null } = {};
      const fullName = changes.fullName?.trim();
      if (fullName !== undefined && fullName !== current.full_name) {
        set.full_name = fullName;
        before.full_name = current.full_name;
      }
      if (changes.email !== undefined && changes.email !== current.email) {
        set.email = changes.email;
        before.email = current.email;
      }
      const changed = Object.keys(set);
      if (changed.length === 0) return current;
      const updated = await trx
        .updateTable('users')
        .set({ ...set, updated_at: new Date() })
        .where('id', '=', id)
        .returning(USER_VIEW_COLUMNS)
        .executeTakeFirstOrThrow();
      await recordAdminAction(trx, { adminId: actorId, action: 'user.update', entityType: 'user', entityId: id, before, after: set });
      await emitEvent(trx, { aggregateType: 'user', aggregateId: id, eventType: 'UserUpdated', payload: { changed } });
      return updated;
    });
  }

  /** BR-014: deactivate instead of delete. Setting the current status again is a no-op. */
  async setStatus(id: string, status: UserStatus, actorId: string): Promise<UserView> {
    return this.db.transaction().execute(async (trx) => {
      const current = await trx.selectFrom('users').select(USER_VIEW_COLUMNS).where('id', '=', id).forUpdate().executeTakeFirst();
      if (!current) throw notFound();
      if (current.status === status) return current;
      const updated = await trx
        .updateTable('users')
        .set({ status, updated_at: new Date() })
        .where('id', '=', id)
        .returning(USER_VIEW_COLUMNS)
        .executeTakeFirstOrThrow();
      const deactivate = status === 'inactive';
      await recordAdminAction(trx, {
        adminId: actorId,
        action: deactivate ? 'user.deactivate' : 'user.activate',
        entityType: 'user',
        entityId: id,
        before: { status: current.status },
        after: { status },
      });
      await emitEvent(trx, { aggregateType: 'user', aggregateId: id, eventType: deactivate ? 'UserDeactivated' : 'UserActivated', payload: {} });
      return updated;
    });
  }
}
