import { api } from './client';
import type { Admin, WorkstationSummary } from './types';

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
