export interface Admin {
  id: string;
  username: string;
  display_name: string;
}

export type WorkstationFlag =
  | 'overdue_session'
  | 'stuck_sync'
  | 'apply_error'
  | 'missing_profile'
  | 'ingest_rejects'
  | 'security_alert';

export type TrustState = 'NoData' | 'Fresh' | 'Expired' | 'ClockInvalid';

export type ProfileStatus = 'enabled' | 'disabled';

export interface Profile {
  os_username: string;
  display_name: string | null;
  profile_type: string | null;
  is_default: boolean;
  status: ProfileStatus;
  description: string | null;
  discovered_at: string | null;
  updated_at: string;
}

export interface Zone {
  id: string;
  name: string;
  location: string;
  description: string | null;
  workstation_count: number;
  created_at: string;
  updated_at: string;
}

export interface WorkstationSummary {
  id: string;
  mqtt_identity: string;
  hostname: string;
  zone: { id: string; name: string } | null;
  status: string;
  connectivity: 'online' | 'offline';
  last_heartbeat_at: string | null;
  trust_state: TrustState | null;
  clock_skew_detected: boolean;
  sync: {
    state: 'in_sync' | 'pending' | 'stuck';
    desired_version: number;
    acked_version: number;
  };
  current_session: {
    user: {
      external_id: string;
      full_name: string;
    };
    started_at: string;
    expires_at: string;
  } | null;
  flags: WorkstationFlag[];
}

export type WorkstationDetail = WorkstationSummary & {
  machine_id: string;
  mac_address: string;
  key_version: number;
  cert_expires_at: string | null;
  last_apply_error: string | null;
  created_at: string;
  updated_at: string;
  profiles: Profile[];
};

export interface Page<T> {
  items: T[];
  next_cursor: string | null;
}

export type UserStatus = 'active' | 'inactive';

export interface User {
  id: string;
  external_id: string;
  full_name: string;
  email: string | null;
  status: UserStatus;
  created_at: string;
  updated_at: string;
}

export type UserDetail = User & {
  cards: {
    id: string;
    status: 'active' | 'disabled' | 'unbound';
    uid_length: number;
    created_at: string;
  }[];
  groups: {
    id: string;
    name: string;
  }[];
};

export interface Group {
  id: string;
  name: string;
  description: string | null;
  member_count: number;
  created_at: string;
  updated_at: string;
}

export type CardStatus = 'active' | 'disabled' | 'unbound';

export interface CardOwner {
  id: string;
  external_id: string;
  full_name: string;
}

export interface Card {
  id: string;
  status: CardStatus;
  uid_length: number;
  owner: CardOwner | null;
  created_at: string;
  updated_at: string;
}

export type CardDetail = Card & {
  uid: string;
};

export interface AuditWorkstation {
  id: string;
  mqtt_identity: string;
  hostname: string;
  zone: { id: string; name: string } | null;
}

export interface AuditUser {
  id: string;
  external_id: string;
  full_name: string;
}

export interface AuditCard {
  id: string;
  status: CardStatus;
}

export interface AuditLog {
  id: string;
  entry_id: string;
  occurred_at: string;
  received_at: string;
  outcome: string;
  reason: string;
  detail: unknown;
  user: AuditUser | null;
  card: AuditCard | null;
  workstation: AuditWorkstation | null;
  target_os_username: string | null;
  data_version: number;
  matched_schedule_ids: string[];
  has_card_uid: boolean;
}

export type SessionStatus = 'active' | 'completed' | 'forced_logout' | 'abandoned';
export type SessionEndReason =
  | 'user_logout'
  | 'schedule_expired'
  | 'workstation_rebooted'
  | 'superseded'
  | 'os_session_lost';
export type SessionEndSource = 'reported' | 'reconstructed' | 'inferred';

export interface Session {
  id: string;
  decision_id: string;
  card_id: string | null;
  os_username: string;
  boot_id: string;
  decided_at: string;
  started_at: string;
  expires_at: string;
  status: SessionStatus;
  ended_at: string | null;
  end_reason: SessionEndReason | null;
  end_source: SessionEndSource | null;
  user: {
    id: string;
    external_id: string;
    full_name: string;
  };
  workstation: {
    id: string;
    mqtt_identity: string;
  };
}

export interface AdminAction {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  before: unknown;
  after: unknown;
  occurred_at: string;
  admin: {
    id: string;
    username: string;
    display_name: string;
  };
}

export type AuditLogDetail = AuditLog & {
  card_uid: string | null;
  reader_raw: string | null;
};

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

export interface ImportSummary {
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
}

export interface ImportResult {
  applied: boolean;
  summary: ImportSummary;
  ignored_columns: string[];
  rows: RowResult[];
}

export interface CreateZoneInput {
  name: string;
  location: string;
  description?: string | null;
}

export interface UpdateZoneChanges {
  name?: string;
  location?: string;
  description?: string | null;
}

export type EnrollmentStatus = 'pending' | 'approved' | 'rejected';

export interface EnrollmentDuplicateOf {
  id: string;
  mqtt_identity: string;
}

export interface EnrollmentWorkstationRef {
  id: string;
  mqtt_identity: string;
}

export interface EnrollmentRequest {
  id: string;
  hostname: string;
  mac_address: string;
  machine_id: string;
  status: EnrollmentStatus;
  submitted_at: string;
  reviewed_at: string | null;
  duplicate_mac_detected: boolean;
  duplicate_of: EnrollmentDuplicateOf | null;
  workstation: EnrollmentWorkstationRef | null;
  note?: string | null;
}

export interface ApproveEnrollmentNewInput {
  mqtt_identity: string;
  zone_id?: string | null;
}

export interface ApproveEnrollmentBatchInput {
  zone_id: string;
  request_ids: string[];
  name_prefix: string;
}

export interface BatchApprovalResult {
  approved: { id: string; mqtt_identity: string; workstation_id: string }[];
  skipped: { id: string; reason: string }[];
}

export type DayOfWeek =
  | 'MONDAY'
  | 'TUESDAY'
  | 'WEDNESDAY'
  | 'THURSDAY'
  | 'FRIDAY'
  | 'SATURDAY'
  | 'SUNDAY';

export type ScheduleStatus = 'enabled' | 'disabled';

export interface ScheduleSubjectInput {
  type: 'user' | 'group';
  id: string;
}

export interface ScheduleTargetInput {
  type: 'workstation' | 'zone';
  id: string;
}

export interface ScheduleInput {
  name: string;
  subject: ScheduleSubjectInput;
  target: ScheduleTargetInput;
  valid_from: string;
  valid_to: string | null;
  days_of_week: DayOfWeek[];
  start_time: string;
  end_time: string;
  target_os_username: string | null;
}

export interface ScheduleSubject extends ScheduleSubjectInput {
  name: string;
  external_id?: string;
}

export interface ScheduleTarget extends ScheduleTargetInput {
  name: string;
}

export interface Schedule {
  id: string;
  name: string;
  subject: ScheduleSubject;
  target: ScheduleTarget;
  valid_from: string;
  valid_to: string | null;
  days_of_week: DayOfWeek[];
  start_time: string;
  end_time: string;
  target_os_username: string | null;
  status: ScheduleStatus;
  created_at: string;
  updated_at: string;
}

export interface ScheduleWarning {
  code: 'ambiguous_profile' | 'missing_profile';
  message: string;
  workstations: { id: string; mqtt_identity: string }[];
  schedule?: { id: string; name: string };
  target_os_username?: string | null;
}

export interface ScheduleValidationErrorDetail {
  field: string;
  constraints: string[];
}

export interface ScheduleValidationResult {
  errors: ScheduleValidationErrorDetail[];
  warnings: ScheduleWarning[];
}

export type ValidateScheduleInput = ScheduleInput & { schedule_id?: string };



