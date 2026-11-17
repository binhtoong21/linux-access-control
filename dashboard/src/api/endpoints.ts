import { api } from './client';
import type {
  Admin,
  Card,
  CardDetail,
  CardStatus,
  Group,
  Page,
  User,
  UserDetail,
  UserStatus,
  WorkstationSummary,
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

