const PREFIX = 'onepick:pick-new-review:';

type SessionStorageLike = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
};

function storage(): SessionStorageLike | null {
  if (typeof globalThis === 'undefined') return null;
  const candidate = (globalThis as typeof globalThis & { sessionStorage?: SessionStorageLike }).sessionStorage;
  return candidate ?? null;
}

export function readPickReviewDraft(userId: string) {
  try {
    const value = storage()?.getItem(PREFIX + userId) ?? '';
    return value.length <= 100 ? value : value.slice(0, 100);
  } catch {
    return '';
  }
}

export function writePickReviewDraft(userId: string, value: string) {
  try {
    const target = storage();
    if (!target) return;
    if (value) target.setItem(PREFIX + userId, value.slice(0, 100));
    else target.removeItem(PREFIX + userId);
  } catch {
    // Session storage can be blocked; the in-memory form still works.
  }
}

export function clearPickReviewDraft(userId: string) {
  try {
    storage()?.removeItem(PREFIX + userId);
  } catch {
    // Ignore storage cleanup failures.
  }
}
