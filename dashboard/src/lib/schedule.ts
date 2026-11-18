import type { DayOfWeek } from '../api/types';

export const DAYS: { day: DayOfWeek; label: string }[] = [
  { day: 'MONDAY', label: 'T2' },
  { day: 'TUESDAY', label: 'T3' },
  { day: 'WEDNESDAY', label: 'T4' },
  { day: 'THURSDAY', label: 'T5' },
  { day: 'FRIDAY', label: 'T6' },
  { day: 'SATURDAY', label: 'T7' },
  { day: 'SUNDAY', label: 'CN' },
];

const CANONICAL_DAYS: DayOfWeek[] = [
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
  'SUNDAY',
];

const WEEKDAYS: DayOfWeek[] = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'];

export function formatDays(days: DayOfWeek[]): string {
  const set = new Set(days);
  if (CANONICAL_DAYS.every((d) => set.has(d))) {
    return 'Hằng ngày';
  }
  if (set.size === 5 && WEEKDAYS.every((d) => set.has(d))) {
    return 'T2–T6';
  }
  return CANONICAL_DAYS.filter((d) => set.has(d))
    .map((d) => DAYS.find((item) => item.day === d)!.label)
    .join(', ');
}

function formatDateVN(dateStr: string): string {
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    const [y, m, d] = parts;
    return `${d.padStart(2, '0')}/${m.padStart(2, '0')}/${y}`;
  }
  return dateStr;
}

export function formatValidity(from: string, to: string | null): string {
  const fromFormatted = formatDateVN(from);
  if (!to) {
    return `từ ${fromFormatted}`;
  }
  return `${fromFormatted} – ${formatDateVN(to)}`;
}

export function todayLocal(d = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const year = parts.find((p) => p.type === 'year')?.value ?? '1970';
  const month = parts.find((p) => p.type === 'month')?.value ?? '01';
  const day = parts.find((p) => p.type === 'day')?.value ?? '01';
  return `${year}-${month}-${day}`;
}

export function isValidTime(s: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$|^24:00$/.test(s);
}

export const OS_USERNAME_REGEX = /^[a-z_][a-z0-9_-]{0,31}$/;

export function isValidOsUsername(s: string): boolean {
  return OS_USERNAME_REGEX.test(s);
}
