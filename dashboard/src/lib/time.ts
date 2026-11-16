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
