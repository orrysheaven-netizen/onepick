const STORAGE_KEY = 'onepick:follow-profile-intent';
const INTENT_TTL_MS = 10 * 60 * 1000;
const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;

type SessionStorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

let memoryValue: string | null = null;

function sessionStore(): SessionStorageLike | null {
  try {
    const store = (globalThis as typeof globalThis & { sessionStorage?: SessionStorageLike }).sessionStorage;
    return store && typeof store.getItem === 'function' && typeof store.setItem === 'function' && typeof store.removeItem === 'function'
      ? store : null;
  } catch {
    return null;
  }
}

function write(value: string | null) {
  memoryValue = value;
  const store = sessionStore();
  if (!store) return;
  try {
    if (value === null) store.removeItem(STORAGE_KEY);
    else store.setItem(STORAGE_KEY, value);
  } catch {
    // In-app browsers may block sessionStorage. The in-memory copy still covers
    // native/same-process auth flows; web redirects require working sessionStorage.
  }
}

function read() {
  const store = sessionStore();
  if (store) {
    try {
      const value = store.getItem(STORAGE_KEY);
      if (value !== null) return value;
    } catch {
      // Fall through to the in-memory copy.
    }
  }
  return memoryValue;
}

export function armFollowProfileIntent(username: string, now = Date.now()) {
  if (!USERNAME_PATTERN.test(username)) {
    write(null);
    return false;
  }
  write(JSON.stringify({ username, expiresAt: now + INTENT_TTL_MS }));
  return true;
}

export function clearFollowProfileIntent() {
  write(null);
}

export function consumeFollowProfileIntent(username: string, now = Date.now()) {
  const raw = read();
  // A continuation can only be used once, including malformed/mismatched values.
  write(null);
  if (!raw || !USERNAME_PATTERN.test(username)) return false;
  try {
    const parsed = JSON.parse(raw) as { username?: unknown; expiresAt?: unknown };
    return parsed.username === username
      && typeof parsed.expiresAt === 'number'
      && Number.isFinite(parsed.expiresAt)
      && parsed.expiresAt >= now
      && parsed.expiresAt <= now + INTENT_TTL_MS;
  } catch {
    return false;
  }
}
