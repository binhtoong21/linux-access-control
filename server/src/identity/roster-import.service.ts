import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { Db, KYSELY } from '../infra/database/database.module';
import { isUniqueViolation } from '../infra/database/pg-errors';
import { recordAdminAction } from '../shared/admin-audit';
import { InvalidUidError, normalizeUid } from '../shared/crypto/crypto-v1';
import { isRandomUid, UidVault } from '../shared/crypto/uid-vault';
import { AppError } from '../shared/http/app-error';
import { emitEvent } from '../shared/outbox';
import { parseRoster, RosterFormatError } from './roster-csv';
import { EXTERNAL_ID_PATTERN } from './users.service';

export type RowAction = 'create' | 'update' | 'unchanged' | 'error';
export type CardAction = 'register' | 'bind' | 'unchanged' | null;

export interface RowIssue {
  code: string;
  message: string;
}

export interface RowResult {
  line: number;
  external_id: string;
  action: RowAction;
  groups_added: string[];
  card: CardAction;
  errors: RowIssue[];
  warnings: RowIssue[];
}

export interface ImportResult {
  applied: boolean;
  summary: {
    rows: number;
    users_created: number;
    users_updated: number;
    users_unchanged: number;
    groups_created: string[];
    memberships_added: number;
    cards_registered: number;
    cards_bound: number;
    errors: number;
    warnings: number;
  };
  ignored_columns: string[];
  rows: RowResult[];
}

class RollbackSentinel {
  constructor(readonly result: ImportResult) {}
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

@Injectable()
export class RosterImportService {
  constructor(
    @Inject(KYSELY) private readonly db: Db,
    private readonly vault: UidVault,
  ) {}

  async run(csv: string, apply: boolean = false, actorId: string): Promise<ImportResult> {
    let parsed;
    try {
      parsed = parseRoster(csv);
    } catch (err) {
      if (err instanceof RosterFormatError) {
        throw new AppError('VALIDATION_ERROR', err.message, [{ field: 'csv', constraints: [err.message] }]);
      }
      throw err;
    }

    try {
      return await this.db.transaction().execute(async (trx) => {
        const seenExternalIds = new Map<string, number>();
        const seenCardUids = new Map<string, { line: number; externalId: string }>();
        const rowResults: RowResult[] = [];
        const groupsCreatedSet = new Set<string>();
        const allNewMemberships: { groupId: string; userId: string; groupName: string }[] = [];

        let usersCreated = 0;
        let usersUpdated = 0;
        let usersUnchanged = 0;
        let cardsRegistered = 0;
        let cardsBound = 0;

        for (const row of parsed.rows) {
          const errors: RowIssue[] = [];
          const warnings: RowIssue[] = [];
          let action: RowAction = 'error';
          let cardAction: CardAction = null;
          let rowGroupsAdded: string[] = [];

          // 1. Validate
          if (!EXTERNAL_ID_PATTERN.test(row.external_id)) {
            errors.push({
              code: 'INVALID_EXTERNAL_ID',
              message: `external_id must match ${EXTERNAL_ID_PATTERN.source}`,
            });
          }

          if (row.external_id) {
            const earlierLine = seenExternalIds.get(row.external_id);
            if (earlierLine !== undefined) {
              errors.push({
                code: 'DUPLICATE_IN_FILE',
                message: `external_id already seen at line ${earlierLine}`,
              });
            } else {
              seenExternalIds.set(row.external_id, row.line);
            }
          }

          if (!row.full_name || row.full_name.length > 255) {
            errors.push({
              code: 'INVALID_FULL_NAME',
              message: 'full_name must not be empty and at most 255 characters',
            });
          }

          if (row.email && (!EMAIL_PATTERN.test(row.email) || row.email.length > 255)) {
            errors.push({
              code: 'INVALID_EMAIL',
              message: 'email is invalid',
            });
          }

          for (const g of row.groups) {
            if (g.length > 100) {
              errors.push({
                code: 'INVALID_GROUP_NAME',
                message: `group name '${g}' exceeds 100 characters`,
              });
            }
          }

          // 2. Card pre-check
          let normalizedUid: string | null = null;
          if (row.card_uid) {
            try {
              normalizedUid = normalizeUid(row.card_uid);
            } catch (err) {
              if (err instanceof InvalidUidError) {
                errors.push({
                  code: 'INVALID_UID',
                  message: 'UID must be 4, 7 or 10 bytes of hex',
                });
              } else {
                throw err;
              }
            }

            if (normalizedUid) {
              if (isRandomUid(normalizedUid)) {
                errors.push({
                  code: 'RANDOM_UID_NOT_SUPPORTED',
                  message: 'Random UIDs (4 bytes starting with 08) change on every tap and cannot be registered',
                });
              } else {
                const earlierCard = seenCardUids.get(normalizedUid);
                if (earlierCard !== undefined && earlierCard.externalId !== row.external_id) {
                  errors.push({
                    code: 'DUPLICATE_IN_FILE',
                    message: `card UID already seen at line ${earlierCard.line} for external_id '${earlierCard.externalId}'`,
                  });
                } else if (earlierCard === undefined) {
                  seenCardUids.set(normalizedUid, { line: row.line, externalId: row.external_id });
                }
              }
            }
          }

          // If validation errors in step 1 or 2, record error action and skip steps 3-5
          if (errors.length > 0) {
            rowResults.push({
              line: row.line,
              external_id: row.external_id,
              action: 'error',
              groups_added: [],
              card: null,
              errors,
              warnings,
            });
            continue;
          }

          // Steps 3-5 in SAVEPOINT
          await sql`SAVEPOINT roster_row`.execute(trx);
          const pendingRowMemberships: { groupId: string; userId: string; groupName: string }[] = [];
          const rowCreatedGroups: string[] = [];
          let rowSuccess = false;

          try {
            // Step 3: User
            let userId: string;
            const user = await trx
              .selectFrom('users')
              .select(['id', 'external_id', 'full_name', 'email', 'status'])
              .where('external_id', '=', row.external_id)
              .forUpdate()
              .executeTakeFirst();

            if (!user) {
              const inserted = await trx
                .insertInto('users')
                .values({
                  external_id: row.external_id,
                  full_name: row.full_name,
                  email: row.email ? row.email : null,
                })
                .returning(['id', 'external_id', 'full_name', 'email', 'status'])
                .executeTakeFirstOrThrow();
              userId = inserted.id;
              action = 'create';
            } else {
              userId = user.id;
              if (user.status === 'inactive') {
                warnings.push({ code: 'USER_INACTIVE', message: 'User is inactive; not reactivated' });
              }

              const set: { full_name?: string; email?: string } = {};
              if (row.full_name !== user.full_name) {
                set.full_name = row.full_name;
              }
              if (row.email && row.email !== user.email) {
                set.email = row.email;
              }

              const changed = Object.keys(set);
              if (changed.length > 0) {
                await trx
                  .updateTable('users')
                  .set({ ...set, updated_at: new Date() })
                  .where('id', '=', user.id)
                  .execute();
                await emitEvent(trx, {
                  aggregateType: 'user',
                  aggregateId: user.id,
                  eventType: 'UserUpdated',
                  payload: { changed },
                });
                action = 'update';
              } else {
                action = 'unchanged';
              }
            }

            // Step 4: Groups
            for (const groupName of row.groups) {
              let group = await trx
                .selectFrom('groups')
                .select(['id', 'name'])
                .where(sql<boolean>`lower(name) = lower(${groupName})`)
                .executeTakeFirst();

              if (!group) {
                group = await trx
                  .insertInto('groups')
                  .values({ name: groupName })
                  .returning(['id', 'name'])
                  .executeTakeFirstOrThrow();
                rowCreatedGroups.push(group.name);
              }

              const alreadyMember = await trx
                .selectFrom('group_members')
                .select('user_id')
                .where('group_id', '=', group.id)
                .where('user_id', '=', userId)
                .executeTakeFirst();

              if (!alreadyMember) {
                rowGroupsAdded.push(group.name);
                pendingRowMemberships.push({ groupId: group.id, userId, groupName: group.name });
              }
            }

            // Step 5: Card
            if (normalizedUid) {
              const index = this.vault.index(normalizedUid);
              const existingCard = await trx
                .selectFrom('cards')
                .leftJoin('users', 'users.id', 'cards.owner_id')
                .select(['cards.id', 'cards.status', 'cards.owner_id', 'users.external_id as owner_external_id'])
                .where('cards.uid_index', '=', index)
                .forUpdate('cards') // only the card row: users is on the nullable side of the join
                .executeTakeFirst();

              if (!existingCard) {
                const enc = this.vault.encrypt(normalizedUid);
                const card = await trx
                  .insertInto('cards')
                  .values({
                    uid_encrypted: enc.ciphertext,
                    uid_iv: enc.iv,
                    uid_auth_tag: enc.authTag,
                    encryption_key_id: enc.keyId,
                    uid_index: index,
                    uid_length: normalizedUid.length / 2,
                    owner_id: userId,
                    status: 'active',
                  })
                  .returning('id')
                  .executeTakeFirstOrThrow();
                await emitEvent(trx, {
                  aggregateType: 'card',
                  aggregateId: card.id,
                  eventType: 'CardBound',
                  payload: { owner_id: userId, previous_owner_id: null },
                });
                cardAction = 'register';
              } else if (existingCard.owner_id === userId) {
                cardAction = 'unchanged';
              } else if (existingCard.status === 'unbound') {
                await trx
                  .updateTable('cards')
                  .set({ status: 'active', owner_id: userId, updated_at: new Date() })
                  .where('id', '=', existingCard.id)
                  .execute();
                await emitEvent(trx, {
                  aggregateType: 'card',
                  aggregateId: existingCard.id,
                  eventType: 'CardBound',
                  payload: { owner_id: userId, previous_owner_id: null },
                });
                cardAction = 'bind';
              } else {
                errors.push({
                  code: 'CARD_ALREADY_BOUND',
                  message: `Card is already bound to user '${existingCard.owner_external_id ?? ''}'`,
                });
              }
            }

            if (errors.length > 0) {
              await sql`ROLLBACK TO SAVEPOINT roster_row`.execute(trx);
              action = 'error';
              cardAction = null;
              rowGroupsAdded = [];
            } else {
              await sql`RELEASE SAVEPOINT roster_row`.execute(trx);
              rowSuccess = true;
            }
          } catch (err) {
            await sql`ROLLBACK TO SAVEPOINT roster_row`.execute(trx);
            // Another admin action created the same user, group or card between our lookup and insert: report it on the
            // row (the whole import is then refused) instead of failing the request; running the check again resolves it.
            if (!isUniqueViolation(err)) throw err;
            errors.push({ code: 'CONFLICT', message: 'Data changed while importing; run the check again' });
            action = 'error';
            cardAction = null;
            rowGroupsAdded = [];
          }

          if (rowSuccess) {
            for (const g of rowCreatedGroups) {
              groupsCreatedSet.add(g);
            }
            for (const m of pendingRowMemberships) {
              allNewMemberships.push(m);
            }
            if (action === 'create') usersCreated++;
            else if (action === 'update') usersUpdated++;
            else if (action === 'unchanged') usersUnchanged++;

            if (cardAction === 'register') cardsRegistered++;
            else if (cardAction === 'bind') cardsBound++;
          }

          rowResults.push({
            line: row.line,
            external_id: row.external_id,
            action,
            groups_added: rowGroupsAdded,
            card: cardAction,
            errors,
            warnings,
          });
        }

        // Insert collected memberships
        if (allNewMemberships.length > 0 && rowResults.every((r) => r.errors.length === 0)) {
          const byGroup = new Map<string, Set<string>>();
          for (const m of allNewMemberships) {
            let set = byGroup.get(m.groupId);
            if (!set) {
              set = new Set<string>();
              byGroup.set(m.groupId, set);
            }
            set.add(m.userId);
          }

          for (const [groupId, userIdsSet] of byGroup) {
            const userIds = [...userIdsSet];
            const inserted = await trx
              .insertInto('group_members')
              .values(userIds.map((user_id) => ({ group_id: groupId, user_id })))
              .onConflict((oc) => oc.columns(['group_id', 'user_id']).doNothing())
              .returning('user_id')
              .execute();

            const added = inserted.map((r) => r.user_id).sort();
            if (added.length > 0) {
              await emitEvent(trx, {
                aggregateType: 'group',
                aggregateId: groupId,
                eventType: 'GroupMembershipChanged',
                payload: { added, removed: [] },
              });
            }
          }
        }

        const totalErrors = rowResults.reduce((sum, r) => sum + r.errors.length, 0);
        const totalWarnings = rowResults.reduce((sum, r) => sum + r.warnings.length, 0);

        const summary = {
          rows: parsed.rows.length,
          users_created: usersCreated,
          users_updated: usersUpdated,
          users_unchanged: usersUnchanged,
          groups_created: Array.from(groupsCreatedSet),
          memberships_added: allNewMemberships.length,
          cards_registered: cardsRegistered,
          cards_bound: cardsBound,
          errors: totalErrors,
          warnings: totalWarnings,
        };

        const result: ImportResult = {
          applied: false,
          summary,
          ignored_columns: parsed.ignoredColumns,
          rows: rowResults,
        };

        if (!apply || summary.errors > 0) {
          throw new RollbackSentinel(result);
        }

        await recordAdminAction(trx, {
          adminId: actorId,
          action: 'roster.import',
          entityType: 'roster',
          entityId: null,
          after: summary,
        });

        return { ...result, applied: true };
      });
    } catch (err) {
      if (err instanceof RollbackSentinel) {
        return err.result;
      }
      throw err;
    }
  }
}
