import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { Db, KYSELY } from '../infra/database/database.module';
import { isUniqueViolation } from '../infra/database/pg-errors';
import { CardStatus } from '../infra/database/schema';
import { recordAdminAction } from '../shared/admin-audit';
import { InvalidUidError, normalizeUid } from '../shared/crypto/crypto-v1';
import { isRandomUid, UidVault } from '../shared/crypto/uid-vault';
import { AppError, ErrorCode } from '../shared/http/app-error';
import { decodeCursor, Page, PAGE_LIMIT_DEFAULT, toPage } from '../shared/http/pagination';
import { emitEvent } from '../shared/outbox';

export interface CardOwner {
  id: string;
  external_id: string;
  full_name: string;
}

// No UID in this view (NFR-SEC03); only CardDetail carries the decrypted UID.
export interface CardView {
  id: string;
  status: CardStatus;
  uid_length: number;
  owner: CardOwner | null;
  created_at: Date;
  updated_at: Date;
}

export interface CardDetail extends CardView {
  uid: string;
}

export interface CardFilter {
  uid?: string;
  userId?: string;
  status?: CardStatus;
  limit?: number;
  cursor?: string;
}

export interface RegisterCard {
  uid?: string;
  fromAuditEntryId?: string;
  userId: string;
}

interface CardRow {
  id: string;
  status: CardStatus;
  uid_length: number;
  owner_id: string | null;
  owner_external_id: string | null;
  owner_full_name: string | null;
  created_at: Date;
  updated_at: Date;
  sort_at: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SORT_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

const fieldError = (code: ErrorCode, field: string, message: string): AppError =>
  new AppError(code, message, [{ field, constraints: [message] }]);
const cardNotFound = (): AppError => new AppError('NOT_FOUND', 'Card not found');
const transition = (status: CardStatus, action: string): AppError =>
  new AppError('INVALID_STATE_TRANSITION', `Cannot ${action} a card that is ${status}`);

function parseUid(raw: string, field: string): string {
  try {
    return normalizeUid(raw);
  } catch (err) {
    if (err instanceof InvalidUidError) throw fieldError('INVALID_UID', field, 'UID must be 4, 7 or 10 bytes of hex');
    throw err;
  }
}

function toView(r: CardRow): CardView {
  return {
    id: r.id,
    status: r.status,
    uid_length: r.uid_length,
    owner: r.owner_id ? { id: r.owner_id, external_id: r.owner_external_id ?? '', full_name: r.owner_full_name ?? '' } : null,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

@Injectable()
export class CardsService {
  constructor(
    @Inject(KYSELY) private readonly db: Db,
    private readonly vault: UidVault,
  ) {}

  private rows(db: Db) {
    return db
      .selectFrom('cards')
      .leftJoin('users', 'users.id', 'cards.owner_id')
      .select([
        'cards.id',
        'cards.status',
        'cards.uid_length',
        'cards.owner_id',
        'users.external_id as owner_external_id',
        'users.full_name as owner_full_name',
        'cards.created_at',
        'cards.updated_at',
        // Microsecond UTC text: a JS Date would drop microseconds and break the keyset cursor.
        sql<string>`to_char(cards.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`.as('sort_at'),
      ]);
  }

  private async view(db: Db, id: string): Promise<CardView> {
    const row = await this.rows(db).where('cards.id', '=', id).executeTakeFirst();
    if (!row) throw cardNotFound();
    return toView(row);
  }

  private async lockCard(db: Db, id: string): Promise<{ status: CardStatus; owner_id: string | null }> {
    const card = await db.selectFrom('cards').select(['status', 'owner_id']).where('id', '=', id).forUpdate().executeTakeFirst();
    if (!card) throw cardNotFound();
    return card;
  }

  private async requireUser(db: Db, userId: string): Promise<void> {
    const user = await db.selectFrom('users').select('id').where('id', '=', userId).executeTakeFirst();
    if (!user) throw new AppError('NOT_FOUND', 'User not found');
  }

  /** Newest first; `uid` is normalized and looked up through the blind index. */
  async list(f: CardFilter): Promise<Page<CardView>> {
    const limit = f.limit ?? PAGE_LIMIT_DEFAULT;
    let query = this.rows(this.db).orderBy('cards.created_at', 'desc').orderBy('cards.id', 'desc').limit(limit + 1);
    if (f.uid !== undefined) query = query.where('cards.uid_index', '=', this.vault.index(parseUid(f.uid, 'uid')));
    if (f.userId) query = query.where('cards.owner_id', '=', f.userId);
    if (f.status) query = query.where('cards.status', '=', f.status);
    if (f.cursor) {
      const [at, id] = decodeCursor(f.cursor, 2);
      if (!SORT_AT.test(at) || !UUID.test(id)) {
        throw fieldError('VALIDATION_ERROR', 'cursor', 'cursor is invalid');
      }
      query = query.where(sql<boolean>`(cards.created_at, cards.id) < (${at}::timestamptz, ${id}::uuid)`);
    }
    return toPage(await query.execute(), limit, (r) => [r.sort_at, r.id], toView);
  }

  async get(id: string): Promise<CardDetail> {
    const enc = await this.db
      .selectFrom('cards')
      .select(['uid_encrypted', 'uid_iv', 'uid_auth_tag', 'encryption_key_id'])
      .where('id', '=', id)
      .executeTakeFirst();
    if (!enc) throw cardNotFound();
    const uid = this.vault.decrypt({ ciphertext: enc.uid_encrypted, iv: enc.uid_iv, authTag: enc.uid_auth_tag, keyId: enc.encryption_key_id });
    return { ...(await this.view(this.db, id)), uid };
  }

  /** FR-032 / FR-073. `created` tells the controller to answer 201 instead of 200. */
  async register(input: RegisterCard, actorId: string): Promise<{ card: CardView; created: boolean }> {
    const uid = await this.resolveUid(input);
    if (isRandomUid(uid)) {
      throw fieldError(
        'RANDOM_UID_NOT_SUPPORTED',
        input.uid !== undefined ? 'uid' : 'from_audit_entry_id',
        'Random UIDs (4 bytes starting with 08) change on every tap and cannot be registered',
      );
    }
    const index = this.vault.index(uid);
    try {
      return await this.db.transaction().execute(async (trx) => {
        await this.requireUser(trx, input.userId);
        const existing = await trx
          .selectFrom('cards')
          .select(['id', 'status', 'owner_id'])
          .where('uid_index', '=', index)
          .forUpdate()
          .executeTakeFirst();
        if (existing) {
          if (existing.owner_id === input.userId) return { card: await this.view(trx, existing.id), created: false };
          if (existing.status !== 'unbound') {
            throw new AppError('CARD_ALREADY_BOUND', 'The card belongs to another user', [{ card_id: existing.id }]);
          }
          await this.bindRow(trx, existing.id, input.userId, actorId);
          return { card: await this.view(trx, existing.id), created: false };
        }
        const enc = this.vault.encrypt(uid);
        const card = await trx
          .insertInto('cards')
          .values({
            uid_encrypted: enc.ciphertext,
            uid_iv: enc.iv,
            uid_auth_tag: enc.authTag,
            encryption_key_id: enc.keyId,
            uid_index: index,
            uid_length: uid.length / 2,
            owner_id: input.userId,
            status: 'active',
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        await recordAdminAction(trx, {
          adminId: actorId,
          action: 'card.register',
          entityType: 'card',
          entityId: card.id,
          after: { status: 'active', owner_id: input.userId, uid_length: uid.length / 2 },
        });
        await emitEvent(trx, { aggregateType: 'card', aggregateId: card.id, eventType: 'CardBound', payload: { owner_id: input.userId, previous_owner_id: null } });
        return { card: await this.view(trx, card.id), created: true };
      });
    } catch (err) {
      // Two registrations of the same new UID at the same moment: the second one loses on the unique blind index.
      if (isUniqueViolation(err, 'uq_cards_uid_index')) throw new AppError('CARD_ALREADY_BOUND', 'The card belongs to another user');
      throw err;
    }
  }

  private async resolveUid(input: RegisterCard): Promise<string> {
    const entryId = input.fromAuditEntryId;
    if ((input.uid === undefined) === (entryId === undefined)) {
      throw fieldError('VALIDATION_ERROR', 'uid', 'Give exactly one of uid or from_audit_entry_id');
    }
    if (input.uid !== undefined) return parseUid(input.uid, 'uid');
    const entry = await this.db
      .selectFrom('audit_logs')
      .select(['reason', 'card_uid_encrypted', 'card_uid_iv', 'card_uid_auth_tag', 'encryption_key_id'])
      .where('entry_id', '=', entryId as string)
      .executeTakeFirst();
    if (!entry) throw new AppError('NOT_FOUND', 'Audit entry not found');
    const { card_uid_encrypted: ciphertext, card_uid_iv: iv, card_uid_auth_tag: authTag, encryption_key_id: keyId } = entry;
    if (entry.reason !== 'unknown_card' || !ciphertext || !iv || !authTag || !keyId) {
      throw fieldError('VALIDATION_ERROR', 'from_audit_entry_id', 'The audit entry is not an unknown_card entry with a card UID');
    }
    return parseUid(this.vault.decrypt({ ciphertext, iv, authTag, keyId }), 'from_audit_entry_id');
  }

  /** unbound → active for userId; rebinding never restores an old `disabled` (state machine §1). */
  private async bindRow(trx: Db, id: string, userId: string, actorId: string): Promise<void> {
    await trx.updateTable('cards').set({ status: 'active', owner_id: userId, updated_at: new Date() }).where('id', '=', id).execute();
    await recordAdminAction(trx, {
      adminId: actorId,
      action: 'card.bind',
      entityType: 'card',
      entityId: id,
      before: { status: 'unbound', owner_id: null },
      after: { status: 'active', owner_id: userId },
    });
    await emitEvent(trx, { aggregateType: 'card', aggregateId: id, eventType: 'CardBound', payload: { owner_id: userId, previous_owner_id: null } });
  }

  async bind(id: string, userId: string, actorId: string): Promise<CardView> {
    return this.db.transaction().execute(async (trx) => {
      await this.requireUser(trx, userId);
      const card = await this.lockCard(trx, id);
      if (card.status === 'unbound') await this.bindRow(trx, id, userId, actorId);
      else if (card.owner_id !== userId) throw transition(card.status, 'bind');
      return this.view(trx, id);
    });
  }

  async setEnabled(id: string, enabled: boolean, actorId: string): Promise<CardView> {
    const target: CardStatus = enabled ? 'active' : 'disabled';
    return this.db.transaction().execute(async (trx) => {
      const card = await this.lockCard(trx, id);
      if (card.status === target) return this.view(trx, id);
      if (card.status === 'unbound') throw transition(card.status, enabled ? 'enable' : 'disable');
      await trx.updateTable('cards').set({ status: target, updated_at: new Date() }).where('id', '=', id).execute();
      await recordAdminAction(trx, {
        adminId: actorId,
        action: enabled ? 'card.enable' : 'card.disable',
        entityType: 'card',
        entityId: id,
        before: { status: card.status },
        after: { status: target },
      });
      await emitEvent(trx, {
        aggregateType: 'card',
        aggregateId: id,
        eventType: enabled ? 'CardEnabled' : 'CardDisabled',
        payload: { owner_id: card.owner_id },
      });
      return this.view(trx, id);
    });
  }

  async unbind(id: string, actorId: string): Promise<CardView> {
    return this.db.transaction().execute(async (trx) => {
      const card = await this.lockCard(trx, id);
      if (card.status === 'unbound') return this.view(trx, id);
      await trx.updateTable('cards').set({ status: 'unbound', owner_id: null, updated_at: new Date() }).where('id', '=', id).execute();
      await recordAdminAction(trx, {
        adminId: actorId,
        action: 'card.unbind',
        entityType: 'card',
        entityId: id,
        before: { status: card.status, owner_id: card.owner_id },
        after: { status: 'unbound', owner_id: null },
      });
      await emitEvent(trx, { aggregateType: 'card', aggregateId: id, eventType: 'CardUnbound', payload: { owner_id: null, previous_owner_id: card.owner_id } });
      return this.view(trx, id);
    });
  }
}
