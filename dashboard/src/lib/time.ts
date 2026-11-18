import type { WorkstationSummary } from '../api/types';

// Must match the server's lease duration (SNAPSHOT_PARAMETERS.lease_duration_sec)
export const LEASE_HOURS = 24;

export function formatTime(iso: string | Date | number, withSeconds = false): string {
  const date = typeof iso === 'string' || typeof iso === 'number' ? new Date(iso) : iso;
  if (isNaN(date.getTime())) return '—';

  const options: Intl.DateTimeFormatOptions = {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  };
  if (withSeconds) {
    options.second = '2-digit';
  }

  return new Intl.DateTimeFormat('vi-VN', options).format(date);
}

export function formatDateTime(iso: string | Date | number | null | undefined): string {
  if (!iso) return '—';
  const date = typeof iso === 'string' || typeof iso === 'number' ? new Date(iso) : iso;
  if (isNaN(date.getTime())) return '—';

  const formatter = new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const partMap: Record<string, string> = {};
  for (const p of parts) {
    partMap[p.type] = p.value;
  }
  return `${partMap.day}/${partMap.month}/${partMap.year} ${partMap.hour}:${partMap.minute}`;
}

export function formatAgo(
  iso: string | Date | number | null | undefined,
  now: number = Date.now(),
): string {
  if (!iso) return '—';
  const date = typeof iso === 'string' || typeof iso === 'number' ? new Date(iso) : iso;
  const time = date.getTime();
  if (isNaN(time)) return '—';

  const diffMs = now - time;
  if (diffMs < 60 * 1000) {
    return 'vừa xong';
  }
  if (diffMs < 60 * 60 * 1000) {
    const minutes = Math.floor(diffMs / (60 * 1000));
    return `${minutes} phút trước`;
  }
  if (diffMs < 48 * 60 * 60 * 1000) {
    const hours = Math.floor(diffMs / (60 * 60 * 1000));
    return `${hours} giờ trước`;
  }
  const days = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  return `${days} ngày trước`;
}

export type ReadinessState =
  | 'ready'
  | 'offline_ok'
  | 'lease_expired'
  | 'no_data'
  | 'clock_invalid'
  | 'disabled';

export function readiness(w: WorkstationSummary, now: number = Date.now()): ReadinessState {
  if (w.status === 'disabled') {
    return 'disabled';
  }
  if (w.trust_state === 'ClockInvalid') {
    return 'clock_invalid';
  }
  if (!w.last_heartbeat_at || w.trust_state === 'NoData' || !w.trust_state) {
    return 'no_data';
  }
  if (w.trust_state === 'Expired') {
    return 'lease_expired';
  }
  const hbTime = new Date(w.last_heartbeat_at).getTime();
  if (isNaN(hbTime)) {
    return 'no_data';
  }
  if (w.connectivity === 'online') {
    return 'ready';
  }
  const leaseMs = LEASE_HOURS * 60 * 60 * 1000;
  if (now - hbTime <= leaseMs) {
    return 'offline_ok';
  }
  return 'lease_expired';
}
