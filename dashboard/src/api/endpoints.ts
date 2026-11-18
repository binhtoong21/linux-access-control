import { api } from './client';
import type {
  Admin,
  AdminAction,
  ApproveEnrollmentBatchInput,
  ApproveEnrollmentNewInput,
  AuditLog,
  AuditLogDetail,
  BatchApprovalResult,
  Card,
  CardDetail,
  CardStatus,
  CreateZoneInput,
  EnrollmentRequest,
  EnrollmentStatus,
  Group,
  ImportResult,
  Page,
  Profile,
  ProfileStatus,
  Session,
  SessionStatus,
  UpdateZoneChanges,
  User,
  UserDetail,
  UserStatus,
  WorkstationDetail,
  WorkstationSummary,
  Zone,
  Schedule,
  ScheduleInput,
  ScheduleStatus,
  ScheduleValidationResult,
  ValidateScheduleInput,
} from './types';

export interface WorkstationFilter {
  connectivity?: 'online' | 'offline';
}

export function login(username: string, password: string): Promise<void> {
  return api<void>('POST', '/auth/login', { username, password });
}

export function logout(): Promise<void> {
  return api<void>('POST', '/auth/logout');
}

export function me(): Promise<Admin> {
  return api<Admin>('GET', '/auth/me');
}

export function listWorkstations(filter?: WorkstationFilter): Promise<WorkstationSummary[]> {
  let path = '/workstations';
  if (filter?.connectivity) {
    path += `?connectivity=${encodeURIComponent(filter.connectivity)}`;
  }
  return api<WorkstationSummary[]>('GET', path);
}

export function getWorkstation(id: string): Promise<WorkstationDetail> {
  return api<WorkstationDetail>('GET', `/workstations/${encodeURIComponent(id)}`);
}

export function updateWorkstationZone(
  id: string,
  zone_id: string | null,
): Promise<WorkstationDetail> {
  return api<WorkstationDetail>('PATCH', `/workstations/${encodeURIComponent(id)}`, { zone_id });
}

export interface UpdateProfileChanges {
  status?: ProfileStatus;
  is_default?: boolean;
}

export function updateProfile(
  id: string,
  os_username: string,
  changes: UpdateProfileChanges,
): Promise<Profile> {
  return api<Profile>(
    'PATCH',
    `/workstations/${encodeURIComponent(id)}/profiles/${encodeURIComponent(os_username)}`,
    changes,
  );
}

export function disableWorkstation(id: string): Promise<WorkstationDetail> {
  return api<WorkstationDetail>('POST', `/workstations/${encodeURIComponent(id)}/disable`, {
    confirm: true,
  });
}

export function listZones(): Promise<Zone[]> {
  return api<Zone[]>('GET', '/zones');
}

export function createZone(input: CreateZoneInput): Promise<Zone> {
  return api<Zone>('POST', '/zones', input);
}

export function updateZone(id: string, changes: UpdateZoneChanges): Promise<Zone> {
  return api<Zone>('PATCH', `/zones/${encodeURIComponent(id)}`, changes);
}

export function deleteZone(id: string): Promise<void> {
  return api<void>('DELETE', `/zones/${encodeURIComponent(id)}`);
}

export interface ListUsersFilter {
  q?: string;
  status?: UserStatus;
  group_id?: string;
  cursor?: string;
  limit?: number;
}

export function listUsers(f?: ListUsersFilter): Promise<Page<User>> {
  const params = new URLSearchParams();
  if (f?.q) params.set('q', f.q);
  if (f?.status) params.set('status', f.status);
  if (f?.group_id) params.set('group_id', f.group_id);
  if (f?.cursor) params.set('cursor', f.cursor);
  if (f?.limit !== undefined && f?.limit !== null) params.set('limit', String(f.limit));
  const qs = params.toString();
  return api<Page<User>>('GET', `/users${qs ? `?${qs}` : ''}`);
}

export interface CreateUserInput {
  external_id: string;
  full_name: string;
  email?: string | null;
}

export function createUser(input: CreateUserInput): Promise<User> {
  return api<User>('POST', '/users', input);
}

export function getUser(id: string): Promise<UserDetail> {
  return api<UserDetail>('GET', `/users/${encodeURIComponent(id)}`);
}

export interface UpdateUserChanges {
  full_name?: string;
  email?: string | null;
}

export function updateUser(id: string, changes: UpdateUserChanges): Promise<User> {
  return api<User>('PATCH', `/users/${encodeURIComponent(id)}`, changes);
}

export function deactivateUser(id: string): Promise<User> {
  return api<User>('POST', `/users/${encodeURIComponent(id)}/deactivate`);
}

export function activateUser(id: string): Promise<User> {
  return api<User>('POST', `/users/${encodeURIComponent(id)}/activate`);
}

export function listGroups(): Promise<Group[]> {
  return api<Group[]>('GET', '/groups');
}

export interface CreateGroupInput {
  name: string;
  description?: string | null;
}

export function createGroup(input: CreateGroupInput): Promise<Group> {
  return api<Group>('POST', '/groups', input);
}

export interface UpdateGroupChanges {
  name?: string;
  description?: string | null;
}

export function updateGroup(id: string, changes: UpdateGroupChanges): Promise<Group> {
  return api<Group>('PATCH', `/groups/${encodeURIComponent(id)}`, changes);
}

export function deleteGroup(id: string): Promise<void> {
  return api<void>('DELETE', `/groups/${encodeURIComponent(id)}`);
}

export function listGroupMembers(id: string): Promise<User[]> {
  return api<User[]>('GET', `/groups/${encodeURIComponent(id)}/members`);
}

export function addGroupMembers(id: string, user_ids: string[]): Promise<{ added: string[] }> {
  return api<{ added: string[] }>('PUT', `/groups/${encodeURIComponent(id)}/members`, { user_ids });
}

export function removeGroupMember(id: string, user_id: string): Promise<void> {
  return api<void>(
    'DELETE',
    `/groups/${encodeURIComponent(id)}/members/${encodeURIComponent(user_id)}`,
  );
}

export interface ListCardsFilter {
  uid?: string;
  user_id?: string;
  status?: CardStatus;
  cursor?: string;
  limit?: number;
}

export function listCards(f?: ListCardsFilter): Promise<Page<Card>> {
  const params = new URLSearchParams();
  if (f?.uid) params.set('uid', f.uid);
  if (f?.user_id) params.set('user_id', f.user_id);
  if (f?.status) params.set('status', f.status);
  if (f?.cursor) params.set('cursor', f.cursor);
  if (f?.limit !== undefined && f?.limit !== null) params.set('limit', String(f.limit));
  const qs = params.toString();
  return api<Page<Card>>('GET', `/cards${qs ? `?${qs}` : ''}`);
}

export function getCard(id: string): Promise<CardDetail> {
  return api<CardDetail>('GET', `/cards/${encodeURIComponent(id)}`);
}

export type RegisterCardInput =
  | { uid: string; user_id: string }
  | { from_audit_entry_id: string; user_id: string };

export function registerCard(input: RegisterCardInput): Promise<Card> {
  return api<Card>('POST', '/cards', input);
}

export function disableCard(id: string): Promise<Card> {
  return api<Card>('POST', `/cards/${encodeURIComponent(id)}/disable`);
}

export function enableCard(id: string): Promise<Card> {
  return api<Card>('POST', `/cards/${encodeURIComponent(id)}/enable`);
}

export function unbindCard(id: string): Promise<Card> {
  return api<Card>('POST', `/cards/${encodeURIComponent(id)}/unbind`);
}

export function bindCard(id: string, user_id: string): Promise<Card> {
  return api<Card>('POST', `/cards/${encodeURIComponent(id)}/bind`, { user_id });
}

export interface ListAuditLogsFilter {
  reason?: string;
  outcome?: string;
  user_id?: string;
  workstation_id?: string;
  zone_id?: string;
  card_uid?: string;
  from?: string;
  to?: string;
  cursor?: string;
  limit?: number;
}

export function listAuditLogs(f?: ListAuditLogsFilter): Promise<Page<AuditLog>> {
  const params = new URLSearchParams();
  if (f?.reason) params.set('reason', f.reason);
  if (f?.outcome) params.set('outcome', f.outcome);
  if (f?.user_id) params.set('user_id', f.user_id);
  if (f?.workstation_id) params.set('workstation_id', f.workstation_id);
  if (f?.zone_id) params.set('zone_id', f.zone_id);
  if (f?.card_uid) params.set('card_uid', f.card_uid);
  if (f?.from) params.set('from', f.from);
  if (f?.to) params.set('to', f.to);
  if (f?.cursor) params.set('cursor', f.cursor);
  if (f?.limit !== undefined && f?.limit !== null) params.set('limit', String(f.limit));
  const qs = params.toString();
  return api<Page<AuditLog>>('GET', `/audit-logs${qs ? `?${qs}` : ''}`);
}

export function getAuditLog(id: string): Promise<AuditLogDetail> {
  return api<AuditLogDetail>('GET', `/audit-logs/${encodeURIComponent(id)}`);
}

export interface ListSessionsFilter {
  workstation_id?: string;
  user_id?: string;
  status?: SessionStatus;
  from?: string;
  to?: string;
  cursor?: string;
  limit?: number;
}

export function listSessions(f?: ListSessionsFilter): Promise<Page<Session>> {
  const params = new URLSearchParams();
  if (f?.workstation_id) params.set('workstation_id', f.workstation_id);
  if (f?.user_id) params.set('user_id', f.user_id);
  if (f?.status) params.set('status', f.status);
  if (f?.from) params.set('from', f.from);
  if (f?.to) params.set('to', f.to);
  if (f?.cursor) params.set('cursor', f.cursor);
  if (f?.limit !== undefined && f?.limit !== null) params.set('limit', String(f.limit));
  const qs = params.toString();
  return api<Page<Session>>('GET', `/sessions${qs ? `?${qs}` : ''}`);
}

export interface ListAdminActionsFilter {
  admin_id?: string;
  entity_type?: string;
  entity_id?: string;
  from?: string;
  to?: string;
  cursor?: string;
  limit?: number;
}

export function listAdminActions(f?: ListAdminActionsFilter): Promise<Page<AdminAction>> {
  const params = new URLSearchParams();
  if (f?.admin_id) params.set('admin_id', f.admin_id);
  if (f?.entity_type) params.set('entity_type', f.entity_type);
  if (f?.entity_id) params.set('entity_id', f.entity_id);
  if (f?.from) params.set('from', f.from);
  if (f?.to) params.set('to', f.to);
  if (f?.cursor) params.set('cursor', f.cursor);
  if (f?.limit !== undefined && f?.limit !== null) params.set('limit', String(f.limit));
  const qs = params.toString();
  return api<Page<AdminAction>>('GET', `/admin-audit-logs${qs ? `?${qs}` : ''}`);
}

export function importRoster(csv: string, apply: boolean): Promise<ImportResult> {
  return api<ImportResult>('POST', '/imports/roster', { csv, apply });
}

export function listEnrollmentRequests(
  status: EnrollmentStatus = 'pending',
): Promise<EnrollmentRequest[]> {
  return api<EnrollmentRequest[]>(
    'GET',
    `/enrollment-requests?status=${encodeURIComponent(status)}`,
  );
}

export function approveEnrollmentNew(
  id: string,
  input: ApproveEnrollmentNewInput,
): Promise<EnrollmentRequest> {
  return api<EnrollmentRequest>(
    'POST',
    `/enrollment-requests/${encodeURIComponent(id)}/approve`,
    {
      mode: 'new',
      mqtt_identity: input.mqtt_identity,
      zone_id: input.zone_id ?? null,
    },
  );
}

export function approveEnrollmentReinstall(id: string): Promise<EnrollmentRequest> {
  return api<EnrollmentRequest>(
    'POST',
    `/enrollment-requests/${encodeURIComponent(id)}/approve`,
    { mode: 'reinstall' },
  );
}

export function approveEnrollmentBatch(
  input: ApproveEnrollmentBatchInput,
): Promise<BatchApprovalResult> {
  return api<BatchApprovalResult>('POST', '/enrollment-requests/approve-batch', input);
}

export function rejectEnrollment(id: string, note?: string): Promise<EnrollmentRequest> {
  const body = note ? { note } : {};
  return api<EnrollmentRequest>(
    'POST',
    `/enrollment-requests/${encodeURIComponent(id)}/reject`,
    body,
  );
}

export interface ListSchedulesFilter {
  workstation_id?: string;
  zone_id?: string;
  group_id?: string;
  user_id?: string;
  status?: ScheduleStatus;
}

export function listSchedules(f?: ListSchedulesFilter): Promise<Schedule[]> {
  const params = new URLSearchParams();
  if (f?.workstation_id) params.set('workstation_id', f.workstation_id);
  if (f?.zone_id) params.set('zone_id', f.zone_id);
  if (f?.group_id) params.set('group_id', f.group_id);
  if (f?.user_id) params.set('user_id', f.user_id);
  if (f?.status) params.set('status', f.status);
  const qs = params.toString();
  return api<Schedule[]>('GET', `/schedules${qs ? `?${qs}` : ''}`);
}

export function getSchedule(id: string): Promise<Schedule> {
  return api<Schedule>('GET', `/schedules/${encodeURIComponent(id)}`);
}

export function createSchedule(input: ScheduleInput): Promise<Schedule> {
  return api<Schedule>('POST', '/schedules', input);
}

export function updateSchedule(id: string, input: ScheduleInput): Promise<Schedule> {
  return api<Schedule>('PATCH', `/schedules/${encodeURIComponent(id)}`, input);
}

export function deleteSchedule(id: string): Promise<void> {
  return api<void>('DELETE', `/schedules/${encodeURIComponent(id)}`);
}

export function enableSchedule(id: string): Promise<Schedule> {
  return api<Schedule>('POST', `/schedules/${encodeURIComponent(id)}/enable`);
}

export function disableSchedule(id: string): Promise<Schedule> {
  return api<Schedule>('POST', `/schedules/${encodeURIComponent(id)}/disable`);
}

export function validateSchedule(input: ValidateScheduleInput): Promise<ScheduleValidationResult> {
  return api<ScheduleValidationResult>('POST', '/schedules/validate', input);
}



