import { describe, it, expect } from 'vitest';
import {
  DAYS,
  formatDays,
  formatValidity,
  isValidTime,
  isValidOsUsername,
  todayLocal,
} from './schedule';

describe('schedule helpers', () => {
  describe('DAYS', () => {
    it('has 7 days ordered MONDAY to SUNDAY with correct labels', () => {
      expect(DAYS).toEqual([
        { day: 'MONDAY', label: 'T2' },
        { day: 'TUESDAY', label: 'T3' },
        { day: 'WEDNESDAY', label: 'T4' },
        { day: 'THURSDAY', label: 'T5' },
        { day: 'FRIDAY', label: 'T6' },
        { day: 'SATURDAY', label: 'T7' },
        { day: 'SUNDAY', label: 'CN' },
      ]);
    });
  });

  describe('formatDays', () => {
    it('formats all seven days as "Hằng ngày"', () => {
      expect(
        formatDays([
          'MONDAY',
          'TUESDAY',
          'WEDNESDAY',
          'THURSDAY',
          'FRIDAY',
          'SATURDAY',
          'SUNDAY',
        ]),
      ).toBe('Hằng ngày');
      // Order should not matter
      expect(
        formatDays([
          'SUNDAY',
          'SATURDAY',
          'FRIDAY',
          'THURSDAY',
          'WEDNESDAY',
          'TUESDAY',
          'MONDAY',
        ]),
      ).toBe('Hằng ngày');
    });

    it('formats Monday through Friday as "T2–T6"', () => {
      expect(formatDays(['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'])).toBe('T2–T6');
      expect(formatDays(['FRIDAY', 'THURSDAY', 'WEDNESDAY', 'TUESDAY', 'MONDAY'])).toBe('T2–T6');
    });

    it('formats mixed days separated by comma in canonical order', () => {
      expect(formatDays(['MONDAY', 'WEDNESDAY', 'FRIDAY'])).toBe('T2, T4, T6');
      expect(formatDays(['FRIDAY', 'MONDAY', 'WEDNESDAY'])).toBe('T2, T4, T6');
      expect(formatDays(['SATURDAY', 'SUNDAY'])).toBe('T7, CN');
      expect(formatDays(['TUESDAY', 'THURSDAY'])).toBe('T3, T5');
      expect(formatDays(['MONDAY'])).toBe('T2');
    });
  });

  describe('formatValidity', () => {
    it('formats validity without valid_to as "từ DD/MM/YYYY"', () => {
      expect(formatValidity('2026-09-01', null)).toBe('từ 01/09/2026');
      expect(formatValidity('2026-12-31', null)).toBe('từ 31/12/2026');
    });

    it('formats validity with valid_to as "DD/MM/YYYY – DD/MM/YYYY"', () => {
      expect(formatValidity('2026-09-01', '2027-01-15')).toBe('01/09/2026 – 15/01/2027');
    });
  });

  describe('isValidTime', () => {
    it('accepts 24:00', () => {
      expect(isValidTime('24:00')).toBe(true);
    });

    it('rejects 24:01', () => {
      expect(isValidTime('24:01')).toBe(false);
    });

    it('rejects 7:30', () => {
      expect(isValidTime('7:30')).toBe(false);
    });

    it('accepts valid HH:MM formats', () => {
      expect(isValidTime('00:00')).toBe(true);
      expect(isValidTime('07:30')).toBe(true);
      expect(isValidTime('12:00')).toBe(true);
      expect(isValidTime('23:59')).toBe(true);
    });

    it('rejects invalid hours, minutes and patterns', () => {
      expect(isValidTime('25:00')).toBe(false);
      expect(isValidTime('12:60')).toBe(false);
      expect(isValidTime('07:3')).toBe(false);
      expect(isValidTime('')).toBe(false);
      expect(isValidTime('abc')).toBe(false);
      expect(isValidTime('24:00:00')).toBe(false);
    });
  });

  describe('todayLocal', () => {
    it('returns a string in YYYY-MM-DD format', () => {
      const today = todayLocal();
      expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('formats given date in Asia/Ho_Chi_Minh', () => {
      // 2026-11-18 01:00 UTC = 2026-11-18 08:00 ICT
      const d = new Date('2026-11-18T01:00:00Z');
      expect(todayLocal(d)).toBe('2026-11-18');
    });
  });

  describe('isValidOsUsername', () => {
    it('validates target_os_username regex ^[a-z_][a-z0-9_-]{0,31}$', () => {
      expect(isValidOsUsername('student')).toBe(true);
      expect(isValidOsUsername('_lab_user')).toBe(true);
      expect(isValidOsUsername('u-1')).toBe(true);
      expect(isValidOsUsername('a')).toBe(true);

      expect(isValidOsUsername('')).toBe(false);
      expect(isValidOsUsername('1user')).toBe(false);
      expect(isValidOsUsername('-user')).toBe(false);
      expect(isValidOsUsername('User')).toBe(false);
      expect(isValidOsUsername('user name')).toBe(false);
      expect(isValidOsUsername('a'.repeat(33))).toBe(false);
    });
  });
});
