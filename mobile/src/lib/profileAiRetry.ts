export function parseRetryAfterSeconds(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > 3600) return null;
  return value;
}

export function retryAfterSecondsFromCause(cause: unknown): number | null {
  if (!cause || typeof cause !== 'object' || Array.isArray(cause)) return null;
  return parseRetryAfterSeconds((cause as Record<string, unknown>).retryAfterSeconds);
}

export function formatRetryDelay(seconds: number): string {
  const safe = parseRetryAfterSeconds(seconds);
  if (!safe) return '잠시';
  if (safe < 60) return `${safe}초`;
  return `${Math.ceil(safe / 60)}분`;
}
