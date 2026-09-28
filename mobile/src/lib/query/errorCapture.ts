// Which query/mutation failures are worth recording in client_error_events.
//
// Expected, user-facing outcomes (no profile yet, a deleted item, a taken username, bad input,
// being offline) are not operational errors and would only drown out real ones. We record
// server/permission failures and anything that is not one of our AppErrors.
const CAPTURED_APP_CODES = new Set([
  'INTERNAL_ERROR',
  'FORBIDDEN',
  'AUTH_FAILED',
  'CATALOG_NOT_CONFIGURED',
  'ACCOUNT_DELETE_FAILED',
  'RATE_LIMITED',
]);

/**
 * The code to record for this failure, or null when it is an expected outcome.
 * Checked structurally (name === 'AppError') so this module stays import-free.
 */
export function capturedErrorCode(error: unknown): string | null {
  if (error instanceof Error && error.name === 'AppError') {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' && CAPTURED_APP_CODES.has(code) ? code : null;
  }
  return 'UNEXPECTED_ERROR';
}

/** A short, alert-safe context label (the spike monitor only accepts [A-Za-z0-9_:./-]). */
export function errorCaptureContext(kind: 'query' | 'mutation', key: readonly unknown[] | undefined) {
  const head = key && key.length > 0 ? String(key[0]) : 'unnamed';
  const safe = head.replace(/[^A-Za-z0-9_./-]/g, '_').slice(0, 60) || 'unnamed';
  return `${kind}:${safe}`;
}

/**
 * Rate limit for captures: the same context+code at most once per window, and at most
 * `maxPerWindow` captures overall, so one broken screen or a retry loop cannot flood the table.
 */
export function createErrorCaptureGate(windowMs = 60_000, maxPerWindow = 10) {
  const lastSeen = new Map<string, number>();
  let windowStart = 0;
  let windowCount = 0;
  return (key: string, now: number) => {
    if (now - windowStart >= windowMs) {
      windowStart = now;
      windowCount = 0;
    }
    const previous = lastSeen.get(key);
    if (previous !== undefined && now - previous < windowMs) return false;
    if (windowCount >= maxPerWindow) return false;
    lastSeen.set(key, now);
    windowCount += 1;
    return true;
  };
}
