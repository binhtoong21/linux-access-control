import { ColumnType, Generated } from 'kysely';

// Kysely table types (07-data/data-model.md). Tables are added here as the modules that query them land.
// BIGSERIAL comes back from pg as a string.

export interface AdminAccountsTable {
  id: Generated<string>;
  username: string;
  display_name: string;
  password_hash: string;
  status: ColumnType<'active' | 'disabled', 'active' | 'disabled' | undefined, 'active' | 'disabled'>;
  created_at: Generated<Date>;
  updated_at: ColumnType<Date, Date | undefined, Date>;
}

export interface AdminAuditLogsTable {
  id: Generated<string>;
  admin_id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  // JSONB written as a JSON string (pg would turn a JS array into a PostgreSQL array).
  before: ColumnType<unknown, string | null, never>;
  after: ColumnType<unknown, string | null, never>;
  occurred_at: Generated<Date>;
}

export interface Database {
  admin_accounts: AdminAccountsTable;
  admin_audit_logs: AdminAuditLogsTable;
}
