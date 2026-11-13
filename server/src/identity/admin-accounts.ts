import { Kysely } from 'kysely';
import { Database } from '../infra/database/schema';
import { isUniqueViolation } from '../infra/database/pg-errors';
import { recordAdminAction } from '../shared/admin-audit';
import { AppError } from '../shared/http/app-error';
import { hashPassword } from './password';

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

export interface AdminView {
  id: string;
  username: string;
  display_name: string;
  status: 'active' | 'disabled';
  created_at: Date;
}

export interface NewAdmin {
  username: string;
  displayName: string;
  password: string;
}

export const ADMIN_VIEW_COLUMNS = ['id', 'username', 'display_name', 'status', 'created_at'] as const;

function invalid(field: string, message: string): AppError {
  return new AppError('VALIDATION_ERROR', message, [{ field, constraints: [message] }]);
}

export function checkPassword(password: string, field = 'password'): void {
  if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
    throw invalid(field, `${field} must be ${PASSWORD_MIN_LENGTH}-${PASSWORD_MAX_LENGTH} characters`);
  }
}

/**
 * Creates an admin and its admin_audit_logs row in one transaction (D-020, INV-016 / VR-010).
 * `actorId = null` is the install-time bootstrap (FR-080): the new admin is recorded as its own actor.
 */
export async function createAdmin(db: Kysely<Database>, input: NewAdmin, actorId: string | null): Promise<AdminView> {
  const username = input.username.trim();
  const displayName = input.displayName.trim();
  if (username.length === 0 || username.length > 64) throw invalid('username', 'username must be 1-64 characters');
  if (displayName.length === 0 || displayName.length > 255) {
    throw invalid('display_name', 'display_name must be 1-255 characters');
  }
  checkPassword(input.password);
  const passwordHash = await hashPassword(input.password);
  try {
    return await db.transaction().execute(async (trx) => {
      const admin = await trx
        .insertInto('admin_accounts')
        .values({ username, display_name: displayName, password_hash: passwordHash })
        .returning(ADMIN_VIEW_COLUMNS)
        .executeTakeFirstOrThrow();
      await recordAdminAction(trx, {
        adminId: actorId ?? admin.id,
        action: actorId ? 'admin.create' : 'admin.bootstrap',
        entityType: 'admin',
        entityId: admin.id,
        after: { username: admin.username, display_name: admin.display_name, status: admin.status },
      });
      return admin;
    });
  } catch (err) {
    if (isUniqueViolation(err, 'uq_admin_username_ci')) {
      throw new AppError('DUPLICATE', `admin username '${username}' already exists`);
    }
    throw err;
  }
}
