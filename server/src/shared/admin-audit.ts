import { Kysely } from 'kysely';
import { Database } from '../infra/database/schema';

export interface AdminAction {
  adminId: string;
  action: string; // e.g. admin.create, card.disable (data-model admin_audit_logs)
  entityType: string;
  entityId?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
}

// D-020: call with the transaction that makes the change, so the change and its audit row commit together.
// Never put raw card UIDs or password hashes into before/after.
export async function recordAdminAction(db: Kysely<Database>, a: AdminAction): Promise<void> {
  await db
    .insertInto('admin_audit_logs')
    .values({
      admin_id: a.adminId,
      action: a.action,
      entity_type: a.entityType,
      entity_id: a.entityId ?? null,
      before: a.before ? JSON.stringify(a.before) : null,
      after: a.after ? JSON.stringify(a.after) : null,
    })
    .execute();
}
