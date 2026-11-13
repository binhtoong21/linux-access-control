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

export type UserStatus = 'active' | 'inactive';
export type CardStatus = 'unbound' | 'active' | 'disabled';

export interface UsersTable {
  id: Generated<string>;
  external_id: string;
  full_name: string;
  email: ColumnType<string | null, string | null | undefined, string | null>;
  status: ColumnType<UserStatus, UserStatus | undefined, UserStatus>;
  created_at: Generated<Date>;
  updated_at: ColumnType<Date, Date | undefined, Date>;
}

export interface GroupsTable {
  id: Generated<string>;
  name: string;
  description: ColumnType<string | null, string | null | undefined, string | null>;
  created_at: Generated<Date>;
  updated_at: ColumnType<Date, Date | undefined, Date>;
}

export interface GroupMembersTable {
  group_id: string;
  user_id: string;
  added_at: Generated<Date>;
}

export interface CardsTable {
  id: Generated<string>;
  uid_encrypted: Buffer;
  uid_iv: Buffer;
  uid_auth_tag: Buffer;
  encryption_key_id: string;
  uid_index: string;
  uid_length: number;
  owner_id: string | null;
  status: ColumnType<CardStatus, CardStatus | undefined, CardStatus>;
  created_at: Generated<Date>;
  updated_at: ColumnType<Date, Date | undefined, Date>;
}

// Only the columns Identity reads (BR-017); the full type lands with Scheduling (M2.4).
export interface SchedulesTable {
  id: Generated<string>;
  name: string;
  subject_user_id: string | null;
  subject_group_id: string | null;
}

export interface ServerOutboxTable {
  id: Generated<string>;
  aggregate_type: string;
  aggregate_id: string;
  event_type: string;
  // JSONB written as a JSON string, like admin_audit_logs.
  payload: ColumnType<unknown, string, never>;
  status: ColumnType<'pending' | 'processed' | 'failed', 'pending' | 'processed' | 'failed' | undefined, 'pending' | 'processed' | 'failed'>;
  created_at: Generated<Date>;
  processed_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
}

// Only the columns Identity reads (FR-073: card from an unknown_card entry); the full type lands with ingest (M3).
export interface AuditLogsTable {
  id: Generated<string>;
  entry_id: string;
  reason: string;
  card_uid_encrypted: Buffer | null;
  card_uid_iv: Buffer | null;
  card_uid_auth_tag: Buffer | null;
  encryption_key_id: string | null;
  card_uid_index: string | null;
}

export interface Database {
  admin_accounts: AdminAccountsTable;
  admin_audit_logs: AdminAuditLogsTable;
  users: UsersTable;
  groups: GroupsTable;
  group_members: GroupMembersTable;
  cards: CardsTable;
  schedules: SchedulesTable;
  server_outbox: ServerOutboxTable;
  audit_logs: AuditLogsTable;
}
