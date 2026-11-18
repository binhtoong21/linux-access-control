import { describe, it, expect } from 'vitest';
import {
  formatAgo,
  formatDateTime,
  formatTime,
  LEASE_HOURS,
  readiness,
} from './time';
import type { WorkstationSummary } from '../api/types';

describe('time utilities', () => {
  describe('formatTime', () => {
    it('formats time in vi-VN Asia/Ho_Chi_Minh', () => {
      // 10:30:00 UTC = 17:30:00 ICT
      const iso = '2026-11-18T10:30:00Z';
      expect(formatTime(iso)).toBe('17:30');
      expect(formatTime(iso, true)).toBe('17:30:00');
    });

    it('returns "—" for invalid inputs', () => {
      expect(formatTime('invalid')).toBe('—');
    });
  });

  describe('formatDateTime', () => {
    it('formats date and time in dd/MM/yyyy HH:mm format', () => {
      // 10:30 UTC = 17:30 ICT
      const iso = '2026-11-18T10:30:00Z';
      expect(formatDateTime(iso)).toBe('18/11/2026 17:30');
    });

    it('returns "—" for null, undefined or invalid date', () => {
      expect(formatDateTime(null)).toBe('—');
      expect(formatDateTime(undefined)).toBe('—');
      expect(formatDateTime('invalid')).toBe('—');
    });
  });

  describe('formatAgo', () => {
    const now = new Date('2026-11-18T12:00:00Z').getTime();

    it('returns "—" for null or invalid inputs', () => {
      expect(formatAgo(null, now)).toBe('—');
      expect(formatAgo(undefined, now)).toBe('—');
      expect(formatAgo('invalid', now)).toBe('—');
    });

    it('returns "vừa xong" for less than 60 seconds', () => {
      const tenSecAgo = new Date(now - 10 * 1000).toISOString();
      expect(formatAgo(tenSecAgo, now)).toBe('vừa xong');

      const fiftyNineSecAgo = new Date(now - 59 * 1000).toISOString();
      expect(formatAgo(fiftyNineSecAgo, now)).toBe('vừa xong');
    });

    it('returns "{n} phút trước" for less than 60 minutes', () => {
      const oneMinAgo = new Date(now - 60 * 1000).toISOString();
      expect(formatAgo(oneMinAgo, now)).toBe('1 phút trước');

      const fiftyNineMinAgo = new Date(now - 59 * 60 * 1000).toISOString();
      expect(formatAgo(fiftyNineMinAgo, now)).toBe('59 phút trước');
    });

    it('returns "{n} giờ trước" for less than 48 hours', () => {
      const oneHourAgo = new Date(now - 60 * 60 * 1000).toISOString();
      expect(formatAgo(oneHourAgo, now)).toBe('1 giờ trước');

      const fortySevenHoursAgo = new Date(now - 47 * 60 * 60 * 1000).toISOString();
      expect(formatAgo(fortySevenHoursAgo, now)).toBe('47 giờ trước');
    });

    it('returns "{n} ngày trước" for 48 hours or older', () => {
      const fortyEightHoursAgo = new Date(now - 48 * 60 * 60 * 1000).toISOString();
      expect(formatAgo(fortyEightHoursAgo, now)).toBe('2 ngày trước');

      const threeDaysAgo = new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString();
      expect(formatAgo(threeDaysAgo, now)).toBe('3 ngày trước');
    });
  });

  describe('readiness', () => {
    const now = new Date('2026-11-18T12:00:00Z').getTime();

    const baseWs: WorkstationSummary = {
      id: 'ws-1',
      mqtt_identity: 'ws-01',
      hostname: 'lab-01',
      zone: null,
      status: 'enrolled',
      connectivity: 'online',
      last_heartbeat_at: '2026-11-18T11:59:00Z',
      trust_state: 'Fresh',
      clock_skew_detected: false,
      sync: { state: 'in_sync', desired_version: 1, acked_version: 1 },
      current_session: null,
      flags: [],
    };

    it('returns "disabled" when status is disabled (checked first)', () => {
      const ws = { ...baseWs, status: 'disabled' };
      expect(readiness(ws, now)).toBe('disabled');
    });

    it('returns "clock_invalid" when trust_state is ClockInvalid', () => {
      const ws = { ...baseWs, trust_state: 'ClockInvalid' as const };
      expect(readiness(ws, now)).toBe('clock_invalid');
    });

    it('returns "no_data" when last_heartbeat_at is null or trust_state is NoData/null', () => {
      expect(readiness({ ...baseWs, last_heartbeat_at: null }, now)).toBe('no_data');
      expect(readiness({ ...baseWs, trust_state: 'NoData' as const }, now)).toBe('no_data');
      expect(readiness({ ...baseWs, trust_state: null }, now)).toBe('no_data');
    });

    it('returns "lease_expired" when trust_state is Expired', () => {
      const ws = { ...baseWs, trust_state: 'Expired' as const };
      expect(readiness(ws, now)).toBe('lease_expired');
    });

    it('returns "ready" when online and trust_state is Fresh', () => {
      expect(readiness(baseWs, now)).toBe('ready');
    });

    it('returns "offline_ok" when offline, trust_state Fresh, and heartbeat within LEASE_HOURS', () => {
      const twoHoursAgo = new Date(now - 2 * 3600 * 1000).toISOString();
      const ws: WorkstationSummary = {
        ...baseWs,
        connectivity: 'offline',
        last_heartbeat_at: twoHoursAgo,
      };
      expect(readiness(ws, now)).toBe('offline_ok');
    });

    it('returns "lease_expired" when offline and heartbeat older than LEASE_HOURS', () => {
      const olderThanLease = new Date(now - (LEASE_HOURS + 1) * 3600 * 1000).toISOString();
      const ws: WorkstationSummary = {
        ...baseWs,
        connectivity: 'offline',
        last_heartbeat_at: olderThanLease,
      };
      expect(readiness(ws, now)).toBe('lease_expired');
    });
  });
});
