import { Inject, Injectable } from '@nestjs/common';
import { Db, KYSELY } from '../infra/database/database.module';
import { recordAdminAction } from '../shared/admin-audit';
import { AppError } from '../shared/http/app-error';
import { ADMIN_VIEW_COLUMNS, AdminView, checkPassword, createAdmin, NewAdmin } from './admin-accounts';
import { hashPassword, verifyPassword } from './password';

@Injectable()
export class AdminsService {
  constructor(@Inject(KYSELY) private readonly db: Db) {}

  list(): Promise<AdminView[]> {
    return this.db.selectFrom('admin_accounts').select(ADMIN_VIEW_COLUMNS).orderBy('created_at').execute();
  }

  create(input: NewAdmin, actorId: string): Promise<AdminView> {
    return createAdmin(this.db, input, actorId);
  }

  /**
   * Enables or disables an admin. Setting the current status again is a no-op without an audit row.
   * INV-016 / D-019.2: the last active admin cannot be disabled. All active rows are locked first (in id order,
   * so concurrent calls cannot deadlock), which makes a second concurrent disable see the first one's result.
   */
  async setStatus(id: string, status: 'active' | 'disabled', actorId: string): Promise<AdminView> {
    return this.db.transaction().execute(async (trx) => {
      const active = await trx
        .selectFrom('admin_accounts')
        .select('id')
        .where('status', '=', 'active')
        .orderBy('id')
        .forUpdate()
        .execute();
      const current = await trx
        .selectFrom('admin_accounts')
        .select(ADMIN_VIEW_COLUMNS)
        .where('id', '=', id)
        .forUpdate()
        .executeTakeFirst();
      if (!current) throw new AppError('NOT_FOUND', 'Admin not found');
      if (current.status === status) return current;
      if (status === 'disabled' && active.length <= 1) {
        throw new AppError('LAST_ACTIVE_ADMIN', 'The last active admin cannot be disabled');
      }
      const updated = await trx
        .updateTable('admin_accounts')
        .set({ status, updated_at: new Date() })
        .where('id', '=', id)
        .returning(ADMIN_VIEW_COLUMNS)
        .executeTakeFirstOrThrow();
      await recordAdminAction(trx, {
        adminId: actorId,
        action: status === 'disabled' ? 'admin.disable' : 'admin.enable',
        entityType: 'admin',
        entityId: id,
        before: { status: current.status },
        after: { status },
      });
      return updated;
    });
  }

  /** The signed-in admin changes their own password; a wrong current password is a field error, not a 401. */
  async changeOwnPassword(adminId: string, currentPassword: string, newPassword: string): Promise<void> {
    checkPassword(newPassword, 'new_password');
    const row = await this.db
      .selectFrom('admin_accounts')
      .select('password_hash')
      .where('id', '=', adminId)
      .executeTakeFirst();
    if (!(await verifyPassword(row?.password_hash ?? null, currentPassword))) {
      const message = 'current_password is incorrect';
      throw new AppError('VALIDATION_ERROR', message, [{ field: 'current_password', constraints: [message] }]);
    }
    const passwordHash = await hashPassword(newPassword);
    await this.db.transaction().execute(async (trx) => {
      await trx
        .updateTable('admin_accounts')
        .set({ password_hash: passwordHash, updated_at: new Date() })
        .where('id', '=', adminId)
        .execute();
      await recordAdminAction(trx, {
        adminId,
        action: 'admin.password_change',
        entityType: 'admin',
        entityId: adminId,
      });
    });
  }
}
