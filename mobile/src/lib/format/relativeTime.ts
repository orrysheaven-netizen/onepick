/**
 * Short Korean "how long ago" label: 방금 · 5분 전 · 3시간 전 · 1~3일 전, then the date
 * (9월 12일, other years 2025.03.01). Over 3 days reads as a date (user decision 2026-10-04).
 */
export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return '';
  const seconds = Math.max(0, Math.round((now.getTime() - time) / 1000));
  if (seconds < 60) return '방금';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  if (days <= 3) return `${days}일 전`;
  const date = new Date(time);
  if (date.getFullYear() === now.getFullYear()) return `${date.getMonth() + 1}월 ${date.getDate()}일`;
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`;
}
